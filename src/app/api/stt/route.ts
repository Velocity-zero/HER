import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stt
 * Accepts WAV audio buffer and returns transcribed text using server-side STT.
 * Operates completely silently without browser search chimes or client-side popups.
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

    // Minimum size for a valid WAV header is 44 bytes
    if (audioBuffer.length < 44) {
      return NextResponse.json({ transcript: "" });
    }

    const scriptPath = path.join(process.cwd(), "scripts", "transcribe.py");

    const transcript = await new Promise<string>((resolve) => {
      const proc = spawn("python", [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      proc.on("error", (err) => {
        console.warn("[STT Route] Python spawn error:", err);
        resolve("");
      });

      const timeout = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        resolve(stdout.trim());
      }, 10000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && stderr) {
          console.warn("[STT Route] Transcribe script warning:", stderr);
        }
        resolve(stdout.trim());
      });

      try {
        proc.stdin.write(audioBuffer);
        proc.stdin.end();
      } catch (writeErr) {
        console.warn("[STT Route] Stdin write error:", writeErr);
        resolve("");
      }
    });

    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("[STT Route Error]:", err);
    return NextResponse.json({ transcript: "", error: "Failed to transcribe audio" }, { status: 500 });
  }
}
