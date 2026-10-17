/**
 * VoicePlayer — Web Audio API gapless streaming voice synthesizer & player.
 *
 * Pipelines sentence audio synthesis:
 * - Fetches sentences sequentially or in parallel from /api/tts
 * - Decodes into Web Audio AudioBuffers
 * - Plays consecutively with zero latency gap between sentences
 * - Provides real-time frequency analysis for audio-reactive visualizers
 * - Supports instantaneous interruption (aborting fetches & stopping playback)
 * - Automatic fallback to browser SpeechSynthesis if network fails
 */

import { ttsManager } from "./tts";

export interface VoicePlayerOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  onSentenceStart?: (sentence: string) => void;
  onSentenceEnd?: (sentence: string) => void;
  onPlaybackEnd?: () => void;
  onBusyStateChange?: (isBusy: boolean) => void;
  onError?: (error: Error) => void;
}

interface QueuedItem {
  id: string;
  text: string;
  bufferPromise?: Promise<AudioBuffer | null>;
  buffer?: AudioBuffer | null;
}

function cleanSentence(raw: string): string {
  if (!raw) return "";
  let text = raw;
  // Convert laughter / sighs to natural conversational sounds
  text = text.replace(/(?:\*|\[|\()\s*(?:laughs|chuckles|giggles|laughter|laughing)\s*(?:\*|\]|\))/gi, " haha ");
  text = text.replace(/(?:\*|\[|\()\s*(?:sighs|sighing|sigh)\s*(?:\*|\]|\))/gi, " ahh... ");
  text = text.replace(/(?:\*|\[|\()\s*(?:clears throat|throat clearing)\s*(?:\*|\]|\))/gi, " ahem... ");
  text = text.replace(/(?:\*|\[|\()\s*(?:yawns|yawning)\s*(?:\*|\]|\))/gi, " ");
  // Strip any remaining asterisk action tags (*smiles*, *pauses*, *looks at you*)
  text = text.replace(/\*[^*]+\*/g, " ");
  // Strip bracketed emotion tags ([whispering], [calm], [warmly])
  text = text.replace(/\[[^\]]+\]/g, " ");
  // Strip parenthetical stage directions
  text = text.replace(/\([^)]+\)/g, " ");
  // Strip markdown formatting characters
  text = text.replace(/[*_#`~>]/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export class VoicePlayer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private queue: QueuedItem[] = [];
  private isPlaying = false;
  private abortController: AbortController | null = null;
  private options: VoicePlayerOptions;
  private frequencyDataArray: Uint8Array<ArrayBuffer> | null = null;

  constructor(options: VoicePlayerOptions = {}) {
    this.options = options;
  }

  public updateOptions(options: Partial<VoicePlayerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  public initAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === "closed") {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.connect(this.audioCtx.destination);
      this.frequencyDataArray = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Explicitly unlock/resume AudioContext on a user click/gesture.
   * Plays a 1-sample silent buffer to force mobile browser audio pipeline permanently open.
   */
  public async unlockAudio(): Promise<void> {
    const ctx = this.initAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }
    try {
      const silentBuffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = silentBuffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {}
    await ttsManager.unlockAudio().catch(() => {});
  }

  /**
   * Queue a sentence for playback and begin prefetching its audio in the background.
   */
  public enqueue(sentence: string): void {
    const text = cleanSentence(sentence);
    if (!text) return;

    if (!this.abortController) {
      this.abortController = new AbortController();
    }

    this.options.onBusyStateChange?.(true);

    const item: QueuedItem = {
      id: Math.random().toString(36).substring(2, 9),
      text,
    };

    // Prefetch audio buffer in the background immediately via decoupled TTSManager
    item.bufferPromise = this.fetchAndDecodeAudio(text, this.abortController.signal);

    this.queue.push(item);

    if (!this.isPlaying) {
      this.processQueue();
    }
  }

  /**
   * Fetches audio buffer from TTSManager and decodes via Web Audio API.
   * Automatically retries once on transient network drops.
   */
  private async fetchAndDecodeAudio(text: string, signal: AbortSignal, retryCount = 0): Promise<AudioBuffer | null> {
    try {
      const arrayBuffer = await ttsManager.synthesize(
        text,
        {
          voice: this.options.voice || "en-US-AvaMultilingualNeural",
          rate: this.options.rate || "+0%",
          pitch: this.options.pitch || "+0Hz",
        },
        signal
      );

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error("No audio returned from TTS engine");
      }

      const ctx = this.initAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }
      // Use slice to avoid detaching buffer issues on WebKit
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      return audioBuffer;
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        return null;
      }
      if (retryCount < 1 && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 300));
        return this.fetchAndDecodeAudio(text, signal, retryCount + 1);
      }
      console.warn("[VoicePlayer] TTS synthesis error:", err);
      return null;
    }
  }

  /**
   * Main player loop processing the queue item by item.
   */
  private async processQueue(): Promise<void> {
    if (this.isPlaying || this.queue.length === 0) return;
    this.isPlaying = true;

    while (this.queue.length > 0) {
      const current = this.queue[0];
      if (!current) break;

      try {
        let buffer = current.buffer;
        if (!buffer && current.bufferPromise) {
          buffer = await current.bufferPromise;
          current.buffer = buffer;
        }

        if (this.abortController?.signal.aborted) {
          break;
        }

        if (buffer) {
          this.options.onSentenceStart?.(current.text);
          await this.playBuffer(buffer);
          this.options.onSentenceEnd?.(current.text);
        } else {
          console.warn("[VoicePlayer] Skipping unrendered sentence:", current.text);
        }
      } catch (playErr) {
        console.error("[VoicePlayer] Playback error:", playErr);
      }

      // Remove finished item
      this.queue.shift();
    }

    this.isPlaying = false;
    this.currentSource = null;

    if (this.queue.length === 0) {
      this.options.onBusyStateChange?.(false);
      this.options.onPlaybackEnd?.();
    }
  }

  /**
   * Plays a single Web Audio buffer to completion with watchdog protection.
   */
  private async playBuffer(buffer: AudioBuffer): Promise<void> {
    const ctx = this.initAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    return new Promise((resolve) => {
      if (!this.analyser) {
        resolve();
        return;
      }

      let isFinished = false;
      const finish = () => {
        if (isFinished) return;
        isFinished = true;
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        resolve();
      };

      // Watchdog timer: Guarantee queue never hangs if AudioContext suspended or audio ends late
      const expectedDurationMs = Math.max(1000, Math.ceil(buffer.duration * 1000) + 700);
      const watchdog = setTimeout(finish, expectedDurationMs);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyser);
      this.currentSource = source;

      source.onended = () => {
        clearTimeout(watchdog);
        finish();
      };

      try {
        source.start(0);
      } catch (err) {
        clearTimeout(watchdog);
        console.warn("[VoicePlayer] Source start failed:", err);
        finish();
      }
    });
  }

  /**
   * Get current frequency data (0..255 per bin) for audio visualizer.
   */
  public getFrequencyData(): Uint8Array | null {
    if (!this.analyser || !this.frequencyDataArray) return null;
    this.analyser.getByteFrequencyData(this.frequencyDataArray);
    return this.frequencyDataArray;
  }

  /**
   * Get normalized volume (0.0 to 1.0).
   */
  public getVolume(): number {
    const data = this.getFrequencyData();
    if (!data || data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const avg = sum / data.length;
    return Math.min(1, avg / 128);
  }

  /**
   * Stop immediately: cuts off current audio, aborts active fetches, clears queue.
   */
  public stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Source may already have ended
      }
      this.currentSource = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    this.queue = [];
    this.isPlaying = false;
    this.options.onBusyStateChange?.(false);
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public isBusy(): boolean {
    return this.isPlaying || this.queue.length > 0;
  }
}
