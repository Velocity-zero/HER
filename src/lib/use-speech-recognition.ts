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
  silenceTimeoutMs?: number; // default: 1300ms
  lang?: string;
  /** Whether HER is currently speaking or streaming audio (mutes STT to prevent feedback) */
  isPlaybackActive?: boolean;
}

/**
 * Encodes Float32Array PCM audio buffer into a standard 16-bit 16kHz Mono WAV Blob.
 * 100% pure JavaScript, zero external dependencies, standard format for speech recognition.
 */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
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
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  /* Write PCM samples */
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * useSpeechRecognition — Full-duplex silent microphone engine for Phone Call mode.
 *
 * Uses navigator.mediaDevices.getUserMedia + Web Audio API:
 * - ZERO Google search earcons/chimes (completely eliminates webkitSpeechRecognition sounds)
 * - Continuous live audio stream that never times out prematurely
 * - Real acoustic Voice Activity Detection (VAD) and silence detection
 * - Seamless server-side transcription via /api/stt
 * - Real-time acoustic volume metrics for AudioAura visualizer
 * - Acoustic echo protection while Samantha is speaking
 */
export function useSpeechRecognition({
  onFinalTranscript,
  onSpeechStart,
  silenceTimeoutMs = 1300,
  isPlaybackActive = false,
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermissionState>("prompt");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const silenceTimeoutMsRef = useRef(silenceTimeoutMs);
  silenceTimeoutMsRef.current = silenceTimeoutMs;

  const isPlaybackActiveRef = useRef(isPlaybackActive);
  const isGracePeriodRef = useRef(false);

  const recordedChunksRef = useRef<Float32Array[]>([]);
  const silenceStartRef = useRef<number | null>(null);
  const speechStartRef = useRef<number | null>(null);
  const isSpeakingRef = useRef(false);
  const currentVolumeRef = useRef(0);
  const isTranscribingRef = useRef(false);
  const energySamplesRef = useRef<number[]>([]);

  // Sync playback active state and manage acoustic echo grace period
  useEffect(() => {
    isPlaybackActiveRef.current = isPlaybackActive;
    if (isPlaybackActive) {
      isGracePeriodRef.current = true;
      silenceStartRef.current = null;
      isSpeakingRef.current = false;
      setIsUserSpeaking(false);
      recordedChunksRef.current = [];
    } else {
      // 350ms grace window so speaker reverb / decay doesn't trip speech detection
      const timer = setTimeout(() => {
        isGracePeriodRef.current = false;
      }, 350);
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
   * Submits accumulated audio buffer to /api/stt for transcription
   */
  const submitRecordedAudio = useCallback(async () => {
    const chunks = recordedChunksRef.current;
    recordedChunksRef.current = [];
    isSpeakingRef.current = false;
    setIsUserSpeaking(false);
    silenceStartRef.current = null;

    if (!chunks.length || isTranscribingRef.current) return;

    // Minimum samples check (~0.35s of audio to ignore short clicks/coughs)
    const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
    if (totalSamples < 5500) return;

    const flattened = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      flattened.set(chunk, offset);
      offset += chunk.length;
    }

    const sampleRate = audioCtxRef.current?.sampleRate || 16000;
    const wavBlob = encodeWAV(flattened, sampleRate);

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

          const durationMs = Math.max(400, Date.now() - (speechStartRef.current || Date.now()));
          const words = text.split(/\s+/).filter(Boolean);
          const wpm = Math.round((words.length / (durationMs / 60000)) || 120);

          const avgEnergy = energySamplesRef.current.length > 0
            ? energySamplesRef.current.reduce((a, b) => a + b, 0) / energySamplesRef.current.length
            : 0.05;

          const energy: "soft" | "intense" | "balanced" =
            avgEnergy < 0.035 ? "soft" : avgEnergy > 0.09 ? "intense" : "balanced";

          const pace: "slow" | "fast" | "moderate" =
            wpm > 175 ? "fast" : wpm < 90 ? "slow" : "moderate";

          let tone: VoiceEmotion["tone"] = "casual";
          if (pace === "slow" && energy === "soft") {
            tone = "hesitant";
          } else if (energy === "intense" && pace === "fast") {
            tone = "excited";
          } else if (energy === "soft" && pace === "slow") {
            tone = "quiet";
          } else if (pace === "fast") {
            tone = "stressed";
          } else if (energy === "soft") {
            tone = "sad";
          } else if (energy === "balanced" && pace === "moderate") {
            tone = "warm";
          }

          const emotion: VoiceEmotion = {
            tone,
            pace,
            energy,
            durationMs,
            pauseCount: 0,
            wpm,
            summary: `${tone} tone, ${pace} pace, ${energy} energy`,
          };

          onFinalTranscriptRef.current?.(text, emotion);
        }
      }
    } catch (err) {
      console.warn("[SpeechRecognition] STT failed:", err);
    } finally {
      isTranscribingRef.current = false;
      energySamplesRef.current = [];
      speechStartRef.current = null;
    }
  }, []);

  /**
   * Starts live audio stream and VAD loop.
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

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;

      // 4096 buffer size gives ~90ms audio chunks at 44.1kHz
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(analyser);
      analyser.connect(processor);
      // Connect to destination via silent gain to keep processor active in Chrome
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
        currentVolumeRef.current = Math.min(1, rms * 14);

        // While Samantha is speaking or synthesizing, mute VAD completely to prevent feedback
        if (isPlaybackActiveRef.current || isGracePeriodRef.current) {
          return;
        }

        const SPEECH_THRESHOLD = 0.022;

        if (rms > SPEECH_THRESHOLD) {
          // User is speaking
          silenceStartRef.current = null;
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            speechStartRef.current = Date.now();
            setIsUserSpeaking(true);
            energySamplesRef.current = [rms];
            onSpeechStartRef.current?.();
          } else {
            energySamplesRef.current.push(rms);
          }
          // Clone the audio chunk
          recordedChunksRef.current.push(new Float32Array(input));
        } else if (isSpeakingRef.current) {
          // In silence phase after user has started speaking
          recordedChunksRef.current.push(new Float32Array(input));
          const now = Date.now();
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= silenceTimeoutMsRef.current) {
            // Silence limit reached — submit chunk for transcription
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
   * Stops audio stream and cleans up resources completely
   */
  const stopListening = useCallback(() => {
    setIsListening(false);
    setIsUserSpeaking(false);
    isSpeakingRef.current = false;
    currentVolumeRef.current = 0;
    silenceStartRef.current = null;
    speechStartRef.current = null;
    recordedChunksRef.current = [];

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
    submitRecordedAudio();
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
