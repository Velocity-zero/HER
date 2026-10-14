/**
 * HER — Voice Styles & Paralinguistics Engine
 *
 * Provides granular emotional prosody and realistic paralinguistic vocalizations
 * for speech synthesis and conversational expression.
 *
 * Supports:
 * - 53 emotional & delivery styles (amazed, amused, angry, annoyed, anxious, etc.)
 * - Realistic human paralinguistics (laughter, coughing, throat clearing, breathing, sighing, yawning)
 * - Automatic extraction of inline tags like [whispering], *sighs*, [laughter], [excited]
 */

export interface VoiceProsodyConfig {
  rate: string;
  pitch: string;
  volume: string;
}

export const VOICE_STYLES: Record<string, VoiceProsodyConfig> = {
  amazed: { rate: "+8%", pitch: "+12Hz", volume: "+10%" },
  amused: { rate: "+6%", pitch: "+6Hz", volume: "+5%" },
  angry: { rate: "+12%", pitch: "+8Hz", volume: "+25%" },
  annoyed: { rate: "+8%", pitch: "+4Hz", volume: "+15%" },
  anxious: { rate: "+18%", pitch: "+8Hz", volume: "+10%" },
  appreciative: { rate: "-3%", pitch: "+3Hz", volume: "+0%" },
  calm: { rate: "-6%", pitch: "-2Hz", volume: "-5%" },
  cautious: { rate: "-10%", pitch: "-3Hz", volume: "-10%" },
  concerned: { rate: "-4%", pitch: "+4Hz", volume: "+5%" },
  confident: { rate: "+5%", pitch: "+4Hz", volume: "+10%" },
  confused: { rate: "-5%", pitch: "+6Hz", volume: "+0%" },
  curious: { rate: "+6%", pitch: "+8Hz", volume: "+5%" },
  defeated: { rate: "-15%", pitch: "-8Hz", volume: "-20%" },
  defensive: { rate: "+10%", pitch: "+6Hz", volume: "+15%" },
  defiant: { rate: "+8%", pitch: "+6Hz", volume: "+15%" },
  determined: { rate: "+6%", pitch: "+4Hz", volume: "+10%" },
  disappointed: { rate: "-12%", pitch: "-6Hz", volume: "-15%" },
  disgusted: { rate: "-6%", pitch: "-4Hz", volume: "+5%" },
  doubtful: { rate: "-8%", pitch: "-2Hz", volume: "-5%" },
  encouraging: { rate: "+6%", pitch: "+6Hz", volume: "+10%" },
  excited: { rate: "+18%", pitch: "+14Hz", volume: "+20%" },
  fast: { rate: "+26%", pitch: "+4Hz", volume: "+5%" },
  fearful: { rate: "+15%", pitch: "+10Hz", volume: "+10%" },
  frustrated: { rate: "+10%", pitch: "+8Hz", volume: "+15%" },
  happy: { rate: "+8%", pitch: "+8Hz", volume: "+10%" },
  hesitant: { rate: "-16%", pitch: "-3Hz", volume: "-10%" },
  hurt: { rate: "-12%", pitch: "-5Hz", volume: "-15%" },
  impatient: { rate: "+18%", pitch: "+6Hz", volume: "+10%" },
  impressed: { rate: "+4%", pitch: "+8Hz", volume: "+10%" },
  intrigued: { rate: "+5%", pitch: "+5Hz", volume: "+5%" },
  laughing: { rate: "+8%", pitch: "+8Hz", volume: "+10%" },
  optimistic: { rate: "+8%", pitch: "+6Hz", volume: "+10%" },
  panicked: { rate: "+24%", pitch: "+14Hz", volume: "+20%" },
  pleading: { rate: "-5%", pitch: "+6Hz", volume: "-5%" },
  quiet: { rate: "-6%", pitch: "-4Hz", volume: "-30%" },
  reassuring: { rate: "-6%", pitch: "-2Hz", volume: "-5%" },
  reflective: { rate: "-10%", pitch: "-4Hz", volume: "-8%" },
  remorseful: { rate: "-12%", pitch: "-6Hz", volume: "-15%" },
  resigned: { rate: "-14%", pitch: "-6Hz", volume: "-15%" },
  sad: { rate: "-16%", pitch: "-8Hz", volume: "-20%" },
  sarcastic: { rate: "-4%", pitch: "+4Hz", volume: "+5%" },
  secretive: { rate: "-8%", pitch: "-5Hz", volume: "-35%" },
  serious: { rate: "-6%", pitch: "-3Hz", volume: "+5%" },
  shouting: { rate: "+15%", pitch: "+15Hz", volume: "+35%" },
  shy: { rate: "-10%", pitch: "+2Hz", volume: "-25%" },
  skeptical: { rate: "-6%", pitch: "+4Hz", volume: "+0%" },
  slow: { rate: "-22%", pitch: "-4Hz", volume: "+0%" },
  surprised: { rate: "+14%", pitch: "+14Hz", volume: "+15%" },
  suspicious: { rate: "-8%", pitch: "-2Hz", volume: "+0%" },
  sympathetic: { rate: "-8%", pitch: "-2Hz", volume: "-5%" },
  upset: { rate: "+10%", pitch: "+6Hz", volume: "+15%" },
  urgent: { rate: "+22%", pitch: "+8Hz", volume: "+20%" },
  whispering: { rate: "-10%", pitch: "-6Hz", volume: "-40%" },
};

/**
 * Phonetic approximations of human paralinguistic utterances
 * for seamless speech synthesis.
 */
export const PARALINGUISTIC_SOUNDS: Record<string, string> = {
  laughter: "haha...",
  laughing: "haha...",
  chuckle: "hehe...",
  chuckles: "hehe...",
  coughing: "cough...",
  cough: "cough...",
  coughs: "cough...",
  throat_clearing: "ahem...",
  throatclearing: "ahem...",
  clearing_throat: "ahem...",
  breathing: "whew...",
  breath: "whew...",
  deep_breath: "whew...",
  sighing: "ahh...",
  sigh: "ahh...",
  sighs: "ahh...",
  yawning: "yaawn...",
  yawn: "yaawn...",
  yawns: "yaawn...",
};

/**
 * Extract styles and paralinguistics from input text.
 * Returns the prosody parameters and the natural speech text with vocalizations.
 */
export function processSpeechText(
  rawText: string,
  initialRate: string = "+0%",
  initialPitch: string = "+0Hz"
): {
  cleanText: string;
  rate: string;
  pitch: string;
  volume: string;
  detectedStyle?: string;
} {
  if (!rawText) {
    return { cleanText: "", rate: initialRate, pitch: initialPitch, volume: "+0%" };
  }

  let text = rawText;
  let rate = initialRate;
  let pitch = initialPitch;
  let volume = "+0%";
  let detectedStyle: string | undefined;

  // 1. Detect bracketed or starred styles (e.g., [whispering], *whispers*, [excited])
  for (const [styleName, prosody] of Object.entries(VOICE_STYLES)) {
    const styleRegex = new RegExp(
      `(?:\\[|\\*|\\()\\s*(${styleName}|${styleName}ly)?\\s*(?:\\]|\\*|\\))`,
      "gi"
    );
    if (styleRegex.test(text)) {
      rate = prosody.rate;
      pitch = prosody.pitch;
      volume = prosody.volume;
      detectedStyle = styleName;
      text = text.replace(styleRegex, " ");
      break;
    }
  }

  // 2. Replace paralinguistics with natural phonetic vocalizations
  for (const [tag, sound] of Object.entries(PARALINGUISTIC_SOUNDS)) {
    const paraRegex = new RegExp(
      `(?:\\[|\\*|\\()\\s*(${tag}|clears throat|takes a breath|takes a deep breath)\\s*(?:\\]|\\*|\\))`,
      "gi"
    );
    if (paraRegex.test(text)) {
      text = text.replace(paraRegex, ` ${sound} `);
    }
  }

  // 3. Clean up loose emotion brackets e.g. [amazed] or [sympathetic]
  text = text.replace(/\[[a-zA-Z_\s-]+\]/g, " ");

  return {
    cleanText: text.replace(/\s+/g, " ").trim(),
    rate,
    pitch,
    volume,
    detectedStyle,
  };
}

/**
 * Server-side TTS synthesis for notification voice notes and background audio generation.
 * Generates an MP3 data URI or buffer representation with emotional prosody.
 */
/**
 * Server-side TTS synthesis for notification voice notes and background audio generation.
 * Generates an MP3 data URI representation with emotional prosody.
 */
export async function synthesizeVoiceNoteAudio(
  text: string,
  preferredVoice: string = "en-US-AvaMultilingualNeural"
): Promise<{ audioUrl: string; duration: number } | null> {
  try {
    const { cleanText, rate, pitch, volume } = processSpeechText(text);
    if (!cleanText) return null;

    const { spawn } = await import("node:child_process");

    const buffer = await new Promise<Buffer | null>((resolve) => {
      const args = [
        "-m", "edge_tts",
        "-v", preferredVoice,
        "--rate", rate,
        "--pitch", pitch,
        "--volume", volume,
        "-t", cleanText,
        "--no-progress",
      ];
      const proc = spawn("python", args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.on("error", () => resolve(null));
      proc.on("close", (code) => {
        if (code !== 0 || chunks.length === 0) {
          resolve(null);
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });

    if (!buffer) return null;

    const base64 = buffer.toString("base64");
    const audioUrl = `data:audio/mpeg;base64,${base64}`;
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(2, Math.round(wordCount * 0.4));
    return { audioUrl, duration };
  } catch (err) {
    console.warn("[VoiceNote Synthesize]", err);
    return null;
  }
}


