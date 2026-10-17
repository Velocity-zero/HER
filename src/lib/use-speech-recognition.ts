"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type MicPermissionState = "prompt" | "granted" | "denied" | "unsupported";

export interface VoiceEmotion {
  tone: "hesitant" | "excited" | "quiet" | "stressed" | "sad" | "warm" | "casual";
  pace: "slow" | "fast" | "moderate";
  energy: "soft" | "intense" | "balanced";
  durationMs: number;
  pauseCount: number;
  wpm: number;
  summary: string;
}

export interface UseSpeechRecognitionOptions {
  onFinalTranscript?: (text: string, emotion?: VoiceEmotion) => void;
  onSpeechStart?: () => void;
  silenceTimeoutMs?: number; // default: 950ms
  lang?: string;
  /** Whether HER is currently speaking or streaming audio (mutes STT to prevent feedback) */
  isPlaybackActive?: boolean;
}

/**
 * Encodes Float32Array PCM samples into standard 16-bit Mono WAV Blob.
 * 100% pure JavaScript, zero external dependencies.
 */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true); // NumChannels (1 for Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Downsamples Float32Array from native AudioContext sampleRate (e.g. 48kHz) to 16kHz
 */
function downsampleTo16k(samples: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return samples;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < samples.length; i++) {
      accum += samples[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : samples[offsetBuffer];
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

/**
 * useSpeechRecognition — Full-duplex silent microphone engine for Phone Call mode.
 *
 * Uses navigator.mediaDevices.getUserMedia + Web Audio API (zero webkitSpeechRecognition):
 * - ZERO Google Voice Search earcons/chimes on Android/Desktop
 * - Circular pre-roll buffer (preserves first syllables: "Hi", "Hey", "Samantha")
 * - Real-time Voice Activity Detection (VAD) with adaptive noise-floor calibration
 * - High-speed transcription via /api/stt (Groq Whisper Turbo / resilient fallback)
 * - Acoustic echo protection & live barge-in interruption while Samantha is speaking
 * - Real-time volume metrics for AudioAura visualizer
 */
export function useSpeechRecognition({
  onFinalTranscript,
  onSpeechStart,
  silenceTimeoutMs = 950,
  isPlaybackActive = false,
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermissionState>("prompt");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const silenceTimeoutMsRef = useRef(silenceTimeoutMs);
  silenceTimeoutMsRef.current = silenceTimeoutMs;

  const isPlaybackActiveRef = useRef(isPlaybackActive);
  const isGracePeriodRef = useRef(false);

  // Audio buffering & VAD refs
  const preRollSlicesRef = useRef<Float32Array[]>([]);
  const utteranceSlicesRef = useRef<Float32Array[]>([]);
  const isSpeakingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const speechStartTimestampRef = useRef<number | null>(null);
  const currentVolumeRef = useRef(0);
  const isTranscribingRef = useRef(false);
  const noiseFloorRef = useRef(0.008);

  // Manage playback active state and acoustic echo grace period
  useEffect(() => {
    isPlaybackActiveRef.current = isPlaybackActive;
    if (isPlaybackActive) {
      isGracePeriodRef.current = true;
      silenceStartRef.current = null;
      isSpeakingRef.current = false;
      setIsUserSpeaking(false);
      utteranceSlicesRef.current = [];
    } else {
      // 300ms grace window so speaker reverb/decay doesn't trip user speech detection
      const timer = setTimeout(() => {
        isGracePeriodRef.current = false;
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isPlaybackActive]);

  // Check initial microphone permissions
  useEffect(() => {
    if (typeof window !== "undefined" && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((perm) => {
          if (perm.state === "granted") setMicPermission("granted");
          else if (perm.state === "denied") setMicPermission("denied");
          else setMicPermission("prompt");

          perm.onchange = () => {
            if (perm.state === "granted") setMicPermission("granted");
            else if (perm.state === "denied") setMicPermission("denied");
            else setMicPermission("prompt");
          };
        })
        .catch(() => {});
    }
  }, []);

  /**
   * Finalizes accumulated audio slices, downsamples to 16kHz WAV, and sends to /api/stt
   */
  const submitRecordedAudio = useCallback(async () => {
    const slices = utteranceSlicesRef.current;
    utteranceSlicesRef.current = [];
    isSpeakingRef.current = false;
    setIsUserSpeaking(false);
    silenceStartRef.current = null;

    if (!slices.length || isTranscribingRef.current) return;

    // Minimum samples check (~0.35s of speech)
    const totalSamples = slices.reduce((acc, s) => acc + s.length, 0);
    const nativeSampleRate = audioCtxRef.current?.sampleRate || 48000;
    if (totalSamples < nativeSampleRate * 0.35) return;

    const flattened = new Float32Array(totalSamples);
    let offset = 0;
    for (const slice of slices) {
      flattened.set(slice, offset);
      offset += slice.length;
    }

    // Downsample to 16kHz for instant transmission
    const samples16k = downsampleTo16k(flattened, nativeSampleRate);
    const wavBlob = encodeWAV(samples16k, 16000);

    isTranscribingRef.current = true;
    try {
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wavBlob,
      });

      if (res.ok) {
        const data = await res.json();
        const text = (data.transcript || "").trim();
        if (text) {
          setTranscript(text);
          const durationMs = Math.max(400, Date.now() - (speechStartTimestampRef.current || Date.now()));
          const words = text.split(/\s+/).filter(Boolean);
          const wpm = Math.round((words.length / (durationMs / 60000)) || 120);
          const pace: "slow" | "fast" | "moderate" = wpm > 175 ? "fast" : wpm < 90 ? "slow" : "moderate";

          const emotion: VoiceEmotion = {
            tone: pace === "slow" ? "hesitant" : pace === "fast" ? "excited" : "warm",
            pace,
            energy: "balanced",
            durationMs,
            pauseCount: 0,
            wpm,
            summary: `${pace} pace, balanced energy`,
          };

          onFinalTranscriptRef.current?.(text, emotion);
        }
      }
    } catch (err) {
      console.warn("[SpeechRecognition] Transcription request error:", err);
    } finally {
      isTranscribingRef.current = false;
      speechStartTimestampRef.current = null;
    }
  }, []);

  /**
   * Starts live audio stream and audio graph.
   * Completely silent — zero system search bleeps or chimes.
   */
  const startListening = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicPermission("unsupported");
      setErrorMessage("Microphone is not supported in this browser.");
      return;
    }

    if (streamRef.current) {
      setIsListening(true);
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume().catch(() => {});
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      setMicPermission("granted");
      setErrorMessage(null);
      setIsListening(true);

      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioCtxRef.current = audioCtx;

      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      // 4096 buffer size gives ~85-92ms audio slices at 44.1/48kHz
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(analyser);
      analyser.connect(processor);

      // Silent gain to destination keeps processor running in Chrome/Safari without audio feedback
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);

        // Calculate instantaneous RMS volume
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }
        const rms = Math.sqrt(sum / input.length);
        const normalizedVol = Math.min(1, rms * 14);
        currentVolumeRef.current = normalizedVol;

        // While Samantha is speaking: check for acoustic barge-in interruption
        if (isPlaybackActiveRef.current) {
          if (rms > 0.045) {
            // User interrupted Samantha
            onSpeechStartRef.current?.();
          }
          return;
        }

        // Post-speech echo grace period
        if (isGracePeriodRef.current) {
          return;
        }

        // Maintain rolling 450ms pre-roll buffer (~5 slices of 4096 samples)
        const sliceCopy = new Float32Array(input);
        const preRoll = preRollSlicesRef.current;
        preRoll.push(sliceCopy);
        if (preRoll.length > 5) {
          preRoll.shift();
        }

        // Adapt ambient noise floor slowly during quiet moments
        if (rms < 0.02) {
          noiseFloorRef.current = noiseFloorRef.current * 0.95 + rms * 0.05;
        }

        // Adaptive speech trigger threshold
        const SPEECH_START_THRESHOLD = Math.max(0.016, noiseFloorRef.current * 2.8);

        if (rms >= SPEECH_START_THRESHOLD) {
          silenceStartRef.current = null;
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            speechStartTimestampRef.current = Date.now();
            setIsUserSpeaking(true);
            onSpeechStartRef.current?.();

            // Prepend pre-roll buffer so initial words ("Hi", "Hey") are fully preserved
            utteranceSlicesRef.current = [...preRollSlicesRef.current];
          } else {
            utteranceSlicesRef.current.push(sliceCopy);
          }
        } else if (isSpeakingRef.current) {
          // Trailing silence detection after user started speaking
          utteranceSlicesRef.current.push(sliceCopy);
          const now = Date.now();
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= silenceTimeoutMsRef.current) {
            // Conversational pause completed — submit utterance for transcription
            submitRecordedAudio();
          }
        }
      };
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name;
      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        setMicPermission("denied");
        setErrorMessage("Microphone permission was denied.");
      } else {
        setErrorMessage("Unable to access microphone.");
      }
      setIsListening(false);
    }
  }, [submitRecordedAudio]);

  /**
   * Stops audio stream and cleans up all audio graph resources
   */
  const stopListening = useCallback(() => {
    setIsListening(false);
    setIsUserSpeaking(false);
    isSpeakingRef.current = false;
    currentVolumeRef.current = 0;
    silenceStartRef.current = null;
    speechStartTimestampRef.current = null;
    preRollSlicesRef.current = [];
    utteranceSlicesRef.current = [];

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      analyserRef.current = null;
    }

    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close().catch(() => {});
      } catch {}
      audioCtxRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const getMicVolume = useCallback((): number => {
    return currentVolumeRef.current;
  }, []);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    await startListening();
    return streamRef.current !== null;
  }, [startListening]);

  const submitTranscript = useCallback(() => {
    if (isSpeakingRef.current) {
      submitRecordedAudio();
    }
  }, [submitRecordedAudio]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    isUserSpeaking,
    transcript,
    micPermission,
    errorMessage,
    requestMicPermission,
    startListening,
    stopListening,
    submitTranscript,
    getMicVolume,
  };
}
