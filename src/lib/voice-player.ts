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

export interface VoicePlayerOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  onSentenceStart?: (sentence: string) => void;
  onSentenceEnd?: (sentence: string) => void;
  onPlaybackEnd?: () => void;
  onError?: (error: Error) => void;
}

interface QueuedItem {
  id: string;
  text: string;
  bufferPromise?: Promise<AudioBuffer | null>;
  buffer?: AudioBuffer | null;
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
   */
  public async unlockAudio(): Promise<void> {
    const ctx = this.initAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }
  }

  /**
   * Queue a sentence for playback and begin prefetching its audio in the background.
   */
  public enqueue(sentence: string): void {
    const text = sentence.trim();
    if (!text) return;

    if (!this.abortController) {
      this.abortController = new AbortController();
    }

    const item: QueuedItem = {
      id: Math.random().toString(36).substring(2, 9),
      text,
    };

    // Prefetch audio buffer in the background immediately
    item.bufferPromise = this.fetchAndDecodeAudio(text, this.abortController.signal);

    this.queue.push(item);

    if (!this.isPlaying) {
      this.processQueue();
    }
  }

  /**
   * Fetches audio buffer from /api/tts and decodes via Web Audio API.
   */
  private async fetchAndDecodeAudio(text: string, signal: AbortSignal): Promise<AudioBuffer | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: this.options.voice || "en-US-AvaMultilingualNeural",
          rate: this.options.rate || "+0%",
          pitch: this.options.pitch || "+0Hz",
        }),
        signal,
      });

      if (!res.ok) {
        throw new Error(`TTS HTTP error: ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const ctx = this.initAudioContext();
      // Use slice to avoid detaching buffer issues on WebKit
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      return audioBuffer;
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        return null;
      }
      console.warn("[VoicePlayer] Edge TTS fetch failed, will fallback if needed:", err);
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
          // Edge TTS failed — fallback to browser SpeechSynthesis for this sentence
          await this.playFallbackSpeech(current.text);
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
      this.options.onPlaybackEnd?.();
    }
  }

  /**
   * Plays a single Web Audio buffer to completion.
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

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyser);
      this.currentSource = source;

      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        resolve();
      };

      try {
        source.start(0);
      } catch (err) {
        console.warn("[VoicePlayer] Source start failed:", err);
        resolve();
      }
    });
  }

  /**
   * Fallback using browser SpeechSynthesis if edge-tts is unavailable.
   */
  private playFallbackSpeech(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve();
        return;
      }

      this.options.onSentenceStart?.(text);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        this.options.onSentenceEnd?.(text);
        resolve();
      };

      utterance.onerror = () => {
        resolve();
      };

      window.speechSynthesis.speak(utterance);
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
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
