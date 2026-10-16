"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { MicPermissionState } from "./use-speech-recognition";

export interface UsePhoneAudioOptions {
  onFinalTranscript?: (text: string) => void;
  onSpeechStart?: () => void;
  silenceTimeoutMs?: number; // default: 1100ms
  isPlayingVoice?: boolean;
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
 * usePhoneAudio — Full-duplex silent microphone engine for Phone Call mode.
 *
 * Uses navigator.mediaDevices.getUserMedia + Web Audio API:
 * - ZERO Chrome voice search bleeps/chimes (unlike webkitSpeechRecognition)
 * - Continuous live audio stream that never times out after 5 seconds
 * - Real acoustic Voice Activity Detection (VAD) and silence detection
 * - Seamless server-side transcription via /api/stt
 * - Real mic volume metrics for AudioAura visualizer
 */
export function usePhoneAudio({
  onFinalTranscript,
  onSpeechStart,
  silenceTimeoutMs = 1100,
  isPlayingVoice = false,
}: UsePhoneAudioOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermissionState>("prompt");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const isPlayingVoiceRef = useRef(isPlayingVoice);
  isPlayingVoiceRef.current = isPlayingVoice;

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  const recordedChunksRef = useRef<Float32Array[]>([]);
  const silenceStartRef = useRef<number | null>(null);
  const speechStartRef = useRef<number | null>(null);
  const isSpeakingRef = useRef(false);
  const currentVolumeRef = useRef(0);
  const isTranscribingRef = useRef(false);

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
    speechStartRef.current = null;

    if (!chunks.length || isTranscribingRef.current) return;

    // Minimum samples check (~0.3s of audio)
    const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
    if (totalSamples < 4800) return;

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
          onFinalTranscriptRef.current?.(text);
        }
      }
    } catch (err) {
      console.warn("[PhoneAudio] STT transcription failed:", err);
    } finally {
      isTranscribingRef.current = false;
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
        if (isMutedRef.current) {
          currentVolumeRef.current = 0;
          return;
        }

        const input = e.inputBuffer.getChannelData(0);

        // Calculate instantaneous RMS volume
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }
        const rms = Math.sqrt(sum / input.length);
        currentVolumeRef.current = Math.min(1, rms * 12);

        // Acoustic barge-in threshold when HER is speaking
        if (isPlayingVoiceRef.current) {
          if (rms > 0.055) {
            // User interrupted Samantha
            onSpeechStartRef.current?.();
          }
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
            onSpeechStartRef.current?.();
          }
          // Clone the audio chunk
          recordedChunksRef.current.push(new Float32Array(input));
        } else if (isSpeakingRef.current) {
          // In silence phase after user has started speaking
          recordedChunksRef.current.push(new Float32Array(input));
          const now = Date.now();
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= silenceTimeoutMs) {
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
  }, [silenceTimeoutMs, submitRecordedAudio]);

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

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const getMicVolume = useCallback((): number => {
    if (isMutedRef.current || !isListening) return 0;
    return currentVolumeRef.current;
  }, [isListening]);

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
    setTranscript,
    micPermission,
    errorMessage,
    isMuted,
    toggleMute,
    startListening,
    stopListening,
    submitTranscript,
    getMicVolume,
    requestMicPermission,
  };
}
