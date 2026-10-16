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
  silenceTimeoutMs?: number; // default: 1100ms
  lang?: string;
  /** Whether HER is currently speaking or streaming audio (mutes STT to prevent feedback) */
  isPlaybackActive?: boolean;
}

/**
 * useSpeechRecognition — Full-duplex silent microphone engine for Phone Call mode.
 *
 * Uses navigator.mediaDevices.getUserMedia + native MediaRecorder + AnalyserNode VAD:
 * - ZERO Google Voice Search earcons/chimes (completely eliminates webkitSpeechRecognition sound)
 * - Highly sensitive, reliable Voice Activity Detection (VAD) via real-time frequency analysis
 * - Hardware-accelerated Opus audio recording via native MediaRecorder
 * - Sub-200ms server-side transcription via /api/stt
 * - Continuous live audio volume metrics for AudioAura visualizer
 * - Acoustic echo protection while Samantha is speaking
 */
export function useSpeechRecognition({
  onFinalTranscript,
  onSpeechStart,
  silenceTimeoutMs = 1100,
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const silenceTimeoutMsRef = useRef(silenceTimeoutMs);
  silenceTimeoutMsRef.current = silenceTimeoutMs;

  const isPlaybackActiveRef = useRef(isPlaybackActive);
  const isGracePeriodRef = useRef(false);

  const isSpeakingRef = useRef(false);
  const silenceTimerRef = useRef(0);
  const speechStartTimestampRef = useRef<number | null>(null);
  const currentVolumeRef = useRef(0);
  const isTranscribingRef = useRef(false);

  // Sync playback active state and manage acoustic echo grace period
  useEffect(() => {
    isPlaybackActiveRef.current = isPlaybackActive;
    if (isPlaybackActive) {
      isGracePeriodRef.current = true;
      silenceTimerRef.current = 0;
      isSpeakingRef.current = false;
      setIsUserSpeaking(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      audioChunksRef.current = [];
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

  const startMediaRecording = useCallback(() => {
    if (!streamRef.current) return;
    try {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "audio/webm";

      audioChunksRef.current = [];
      const mr = new MediaRecorder(streamRef.current, { mimeType });
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mr.start(100);
    } catch (err) {
      console.warn("[SpeechRecognition] MediaRecorder start error:", err);
    }
  }, []);

  const stopMediaRecordingAndSubmit = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;

    mr.onstop = async () => {
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      if (!chunks.length || isTranscribingRef.current) return;

      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      // Only transcribe if blob has meaningful audio data (> 1500 bytes)
      if (blob.size < 1500) return;

      isTranscribingRef.current = true;
      try {
        const res = await fetch("/api/stt", {
          method: "POST",
          headers: { "Content-Type": mr.mimeType || "audio/webm" },
          body: blob,
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
        console.warn("[SpeechRecognition] Transcription request failed:", err);
      } finally {
        isTranscribingRef.current = false;
        speechStartTimestampRef.current = null;
      }
    };

    try {
      mr.stop();
    } catch {}
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
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.4;
      analyserRef.current = analyser;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      // High-precision volume monitoring and Voice Activity Detection (60ms ticks)
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;

        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume().catch(() => {});
        }

        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length; // 0 to 255
        const normalized = Math.min(1, avg / 90);
        currentVolumeRef.current = normalized;

        // While Samantha is speaking or synthesizing, mute VAD completely to prevent feedback loop
        if (isPlaybackActiveRef.current || isGracePeriodRef.current) {
          return;
        }

        // Sensitive threshold for normal conversational speech
        const SPEECH_START_THRESHOLD = 6;

        if (avg >= SPEECH_START_THRESHOLD) {
          // User is speaking
          silenceTimerRef.current = 0;
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            speechStartTimestampRef.current = Date.now();
            setIsUserSpeaking(true);
            onSpeechStartRef.current?.();
            startMediaRecording();
          }
        } else if (isSpeakingRef.current) {
          // In silence phase after user has started speaking
          silenceTimerRef.current += 60;
          if (silenceTimerRef.current >= silenceTimeoutMsRef.current) {
            // Silence limit reached — finalize recording and submit for transcription
            isSpeakingRef.current = false;
            setIsUserSpeaking(false);
            silenceTimerRef.current = 0;
            stopMediaRecordingAndSubmit();
          }
        }
      }, 60);
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
  }, [startMediaRecording, stopMediaRecordingAndSubmit]);

  /**
   * Stops audio stream and cleans up resources completely
   */
  const stopListening = useCallback(() => {
    setIsListening(false);
    setIsUserSpeaking(false);
    isSpeakingRef.current = false;
    currentVolumeRef.current = 0;
    silenceTimerRef.current = 0;
    speechStartTimestampRef.current = null;
    audioChunksRef.current = [];

    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
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
      isSpeakingRef.current = false;
      setIsUserSpeaking(false);
      silenceTimerRef.current = 0;
      stopMediaRecordingAndSubmit();
    }
  }, [stopMediaRecordingAndSubmit]);

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
