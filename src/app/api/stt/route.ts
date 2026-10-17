import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stt
 * Accepts WAV / WebM audio buffer and returns transcribed text.
 * 
 * 1. Primary engine: Groq Whisper API (whisper-large-v3-turbo)
 *    - ~100-200ms latency, zero browser chimes, highly accurate conversational transcription
 * 2. Fallback engine: File-backed speech_recognition
 *    - File-isolated, zero anonymous pipe deadlocks, hard 5s timeout
 */
export async function POST(req: NextRequest) {
  try {
    let audioBuffer: Buffer;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("audio") as Blob | null;
      if (!file) {
        return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
      }
      const arrayBuffer = await file.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    } else {
      const arrayBuffer = await req.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return NextResponse.json({ transcript: "" });
    }

    // Minimum size for valid audio header/payload
    if (audioBuffer.length < 44) {
      return NextResponse.json({ transcript: "" });
    }

    const groqApiKey = process.env.GROQ_API_KEY?.trim();

    // ── Engine 1: Groq Whisper Cloud Engine (Ultra-fast, ~150ms) ──
    if (groqApiKey) {
      try {
        const isWav = audioBuffer.subarray(0, 4).toString("ascii") === "RIFF";
        const mimeType = isWav ? "audio/wav" : "audio/webm";
        const fileName = isWav ? "audio.wav" : "audio.webm";

        const groqFormData = new FormData();
        const audioBlob = new Blob([audioBuffer], { type: mimeType });
        groqFormData.append("file", audioBlob, fileName);
        groqFormData.append("model", "whisper-large-v3-turbo");
        groqFormData.append("response_format", "json");
        groqFormData.append("temperature", "0.0");

        const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: groqFormData,
        });

        if (groqRes.ok) {
          const data = await groqRes.json();
          const text = (data.text || "").trim();
          return NextResponse.json({ transcript: text, provider: "groq" });
        } else {
          const errText = await groqRes.text().catch(() => "");
          console.warn("[STT Route] Groq transcription error:", groqRes.status, errText);
        }
      } catch (groqErr) {
        console.warn("[STT Route] Groq fetch exception, falling back:", groqErr);
      }
    }

    // ── Engine 2: Local File-Backed Fallback Engine (Zero pipe deadlock) ──
    const isWav = audioBuffer.subarray(0, 4).toString("ascii") === "RIFF";
    const ext = isWav ? "wav" : "webm";
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `stt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`);

    try {
      await fs.writeFile(tempFile, audioBuffer);
    } catch (writeErr) {
      console.warn("[STT Route] Failed to write temp audio file:", writeErr);
      return NextResponse.json({ transcript: "" });
    }

    const scriptPath = path.join(process.cwd(), "scripts", "transcribe.py");

    const transcript = await new Promise<string>((resolve) => {
      const proc = spawn("python", [scriptPath, tempFile], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      proc.on("error", (err) => {
        console.warn("[STT Route] Python spawn error:", err);
        resolve("");
      });

      // Strict 5.5s timeout to prevent any hanging in phone call
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve(stdout.trim());
      }, 5500);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && stderr) {
          console.warn("[STT Route] Transcribe script notice:", stderr);
        }
        resolve(stdout.trim());
      });
    });

    // Cleanup temp file
    try {
      await fs.unlink(tempFile);
    } catch {}

    return NextResponse.json({
      transcript,
      provider: "local",
      needsGroqKey: !groqApiKey,
    });
  } catch (err) {
    console.error("[STT Route Error]:", err);
    return NextResponse.json({ transcript: "", error: "Failed to transcribe audio" }, { status: 500 });
  }
}
