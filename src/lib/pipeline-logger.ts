/**
 * HER — Pipeline Diagnostic Stage Logger
 *
 * Provides structured hashing and stage metrics across the complete response lifecycle:
 *   LLM Provider → SSE Parser → Chunk Assembly → Post Processing → Persistence → Client → UI Renderer
 *
 * Universal (browser + node compatible) 32-bit FNV-1a hex hash.
 */

export interface PipelineStageLog {
  stage: string;
  character_count: number;
  word_count: number;
  line_count: number;
  last_100_characters: string;
  hash: string;
}

/** Compute deterministic 8-char hex FNV-1a hash (works in Node and Browser) */
export function computePipelineHash(text: string): string {
  if (!text) return "00000000";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiplication integer math
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function logPipelineStage(stage: string, text: string): PipelineStageLog {
  const safeText = text || "";
  const words = safeText.trim() ? safeText.trim().split(/\s+/).filter(Boolean).length : 0;
  const lines = safeText ? safeText.split("\n").length : 0;
  const last100 = safeText.length > 100 ? safeText.slice(-100) : safeText;
  const hash = computePipelineHash(safeText);

  const stageLog: PipelineStageLog = {
    stage,
    character_count: safeText.length,
    word_count: words,
    line_count: lines,
    last_100_characters: last100,
    hash,
  };

  console.log(
    `[HER PIPELINE]\nStage: ${stageLog.stage}\ncharacter_count: ${stageLog.character_count}\nword_count: ${stageLog.word_count}\nline_count: ${stageLog.line_count}\nlast_100_characters: "${stageLog.last_100_characters.replace(/\n/g, "\\n")}"\nhash: ${stageLog.hash}`
  );

  return stageLog;
}
