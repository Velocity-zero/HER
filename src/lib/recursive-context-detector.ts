/**
 * HER — Recursive Context Detector (Step 18.2)
 *
 * Detects when stored data (memories, signals, continuity snapshots, self-
 * state briefs, etc.) contains chunks that look like they were copied from
 * a previous prompt assembly. Recursive context is the single most common
 * cause of token explosion on long-lived accounts — a memory that quietly
 * embeds last week's full system prompt will double prompt size every cycle.
 *
 * This is a DETECTOR only. It logs and reports; it never strips. The fix
 * comes in Phase B once we know which surface is leaking.
 */

/** Markers that should never appear inside another context payload. */
export const RECURSION_MARKERS: ReadonlyArray<string> = [
  "CURRENT CONVERSATIONAL TENDENCIES",     // self-model brief
  "RECENT INTERACTION TEXTURE",            // interaction signals block
  "THINGS YOU REMEMBER ABOUT THIS PERSON", // memory injection header
  "EARLIER IN THIS CONVERSATION (summary)",// summary block
  "RELATIONSHIP STAGE —",                  // rapport block (any level)
  "INTERNAL REFLECTION",                   // reflection layer header
  "CURRENT DATE & TIME",                   // time block
];

export interface RecursionFinding {
  /** Where we found it (memory, signal, continuity, etc.). */
  source: string;
  /** Which marker matched — exact string from RECURSION_MARKERS. */
  marker: string;
  /** Length of the offending payload, for triage. */
  payloadChars: number;
}

/**
 * Scan a single payload for recursive markers.
 * Returns an empty array when clean — that's the common case, so the
 * caller can quickly check `.length` without allocating much.
 */
export function detectRecursiveMarkers(
  source: string,
  payload: string | null | undefined,
): RecursionFinding[] {
  if (!payload || typeof payload !== "string") return [];
  const findings: RecursionFinding[] = [];
  for (const marker of RECURSION_MARKERS) {
    if (payload.includes(marker)) {
      findings.push({
        source,
        marker,
        payloadChars: payload.length,
      });
    }
  }
  return findings;
}

/** Convenience: scan multiple labeled payloads in one call. */
export function auditContextPayloads(
  payloads: Record<string, string | null | undefined>,
): RecursionFinding[] {
  const all: RecursionFinding[] = [];
  for (const [source, payload] of Object.entries(payloads)) {
    all.push(...detectRecursiveMarkers(source, payload));
  }
  return all;
}
