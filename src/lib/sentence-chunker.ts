/**
 * SentenceChunker — Chunks streaming text tokens into sentences for TTS pipelining.
 *
 * Allows audio synthesis to begin on the first sentence (~1.2s into LLM output)
 * while subsequent sentences continue streaming and prefetching in the background.
 */

// Common abbreviations that shouldn't trigger sentence splits
const ABBREVIATIONS = /\b(mr|mrs|ms|dr|prof|sr|jr|vs|e\.g|i\.e|etc|approx)\.$/i;

export class SentenceChunker {
  private buffer: string = "";
  private onSentence: (sentence: string) => void;
  private minSentenceLength: number;

  constructor(onSentence: (sentence: string) => void, minSentenceLength = 12) {
    this.onSentence = onSentence;
    this.minSentenceLength = minSentenceLength;
  }

  /**
   * Append streaming text chunk.
   */
  push(text: string): void {
    if (!text) return;
    this.buffer += text;
    this.extractSentences();
  }

  /**
   * Extract complete sentences from the buffer.
   */
  private extractSentences(): void {
    while (this.buffer.length > 0) {
      // Find sentence boundary: . ! ? or \n followed by whitespace or end of line
      const match = this.findBoundaryIndex(this.buffer);
      if (match === -1) {
        break;
      }

      const candidate = this.buffer.slice(0, match).trim();
      this.buffer = this.buffer.slice(match).trimStart();

      if (candidate.length > 0) {
        this.onSentence(candidate);
      }
    }
  }

  /**
   * Finds the index of the next clean sentence boundary.
   * Returns the end index (exclusive) of the sentence, or -1 if no complete boundary is found.
   */
  private findBoundaryIndex(str: string): number {
    // Regex matches . ! ? or newline followed by space or end-of-string
    const regex = /([.!?]+|\n+)(\s+|$)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(str)) !== null) {
      const delimiterEnd = match.index + match[1].length;
      const candidate = str.slice(0, delimiterEnd);

      // Avoid splitting on ellipsis mid-ellipsis (e.g. "..")
      if (match[1] === "." && str[delimiterEnd] === ".") {
        continue;
      }

      // Avoid splitting on abbreviations e.g. "Dr." or "e.g."
      if (ABBREVIATIONS.test(candidate.trim())) {
        continue;
      }

      // Avoid splitting on decimals e.g. "3.14"
      const prevChar = str[match.index - 1];
      const nextChar = str[delimiterEnd];
      if (prevChar && /\d/.test(prevChar) && nextChar && /\d/.test(nextChar)) {
        continue;
      }

      // If sentence is too short, wait for more text unless it has a newline
      const trimmed = candidate.trim();
      if (trimmed.length < this.minSentenceLength && !match[1].includes("\n")) {
        // If there is still plenty of text ahead, we can emit it anyway
        if (str.length - delimiterEnd < 20) {
          continue;
        }
      }

      return delimiterEnd;
    }

    return -1;
  }

  /**
   * Flush any remaining text in the buffer when the stream completes.
   */
  flush(): void {
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      this.onSentence(remaining);
    }
    this.buffer = "";
  }

  /**
   * Reset the chunker buffer.
   */
  reset(): void {
    this.buffer = "";
  }
}
