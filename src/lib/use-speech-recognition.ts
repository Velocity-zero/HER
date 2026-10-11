"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Web Speech API interfaces
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface IWindowSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionConstructor {
  new (): IWindowSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type MicPermissionState = "prompt" | "granted" | "denied" | "unsupported";

export interface UseSpeechRecognitionOptions {
  onFinalTranscript?: (text: string) => void;
  onSpeechStart?: () => void;
  silenceTimeoutMs?: number; // default: 1500ms
  lang?: string;
}

export function useSpeechRecognition({
  onFinalTranscript,
  onSpeechStart,
  silenceTimeoutMs = 1500,
  lang = "en-US",
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermissionState>("prompt");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep callback options in refs to avoid re-triggering start/stop effects
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const silenceTimeoutMsRef = useRef(silenceTimeoutMs);
  silenceTimeoutMsRef.current = silenceTimeoutMs;

  const langRef = useRef(lang);
  langRef.current = lang;

  const recognitionRef = useRef<IWindowSpeechRecognition | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micDataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const shouldListenRef = useRef(false);
  const isStartingRef = useRef(false);
  const finalTranscriptAccumulatorRef = useRef("");

  // Check Web Speech API support on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      if (!hasSpeech) {
        setMicPermission("unsupported");
        setErrorMessage("Speech recognition is not supported in this browser");
      }
    }
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Cleanup mic audio nodes
  const cleanupMicAudio = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (micAudioCtxRef.current && micAudioCtxRef.current.state !== "closed") {
      micAudioCtxRef.current.close().catch(() => {});
      micAudioCtxRef.current = null;
    }
    micAnalyserRef.current = null;
    micDataArrayRef.current = null;
  }, []);

  // Submit finalized transcript and reset buffer
  const submitTranscript = useCallback(() => {
    clearSilenceTimer();
    const final = (finalTranscriptAccumulatorRef.current + " " + transcript).trim();
    if (final) {
      onFinalTranscriptRef.current?.(final);
      finalTranscriptAccumulatorRef.current = "";
      setTranscript("");
    }
    setIsUserSpeaking(false);
  }, [clearSilenceTimer, transcript]);

  const restartSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      clearSilenceTimer();
      const final = finalTranscriptAccumulatorRef.current.trim();
      if (final) {
        onFinalTranscriptRef.current?.(final);
        finalTranscriptAccumulatorRef.current = "";
        setTranscript("");
      }
      setIsUserSpeaking(false);
    }, silenceTimeoutMsRef.current);
  }, [clearSilenceTimer]);

  // Setup mic audio stream for visualizer frequency analysis (non-blocking)
  const setupMicAudio = useCallback(async () => {
    // If stream is already active, don't recreate
    if (micStreamRef.current && micStreamRef.current.active) return;

    try {
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicPermission("granted");
      setErrorMessage(null);

      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      micAudioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);

      micAnalyserRef.current = analyser;
      micDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name;
      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        setMicPermission("denied");
        setErrorMessage("Microphone permission denied");
      }
      console.warn("[STT] Optional mic audio visualizer setup notice:", err);
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    isStartingRef.current = false;
    clearSilenceTimer();
    setIsListening(false);
    setIsUserSpeaking(false);
    finalTranscriptAccumulatorRef.current = "";
    setTranscript("");

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    cleanupMicAudio();
  }, [clearSilenceTimer, cleanupMicAudio]);

  const startListening = useCallback(async () => {
    if (typeof window === "undefined") return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setMicPermission("unsupported");
      setErrorMessage("Speech recognition not supported in this browser");
      return;
    }

    // Prevent duplicate concurrent start calls
    if (shouldListenRef.current && recognitionRef.current) {
      return;
    }

    if (isStartingRef.current) return;
    isStartingRef.current = true;

    shouldListenRef.current = true;
    finalTranscriptAccumulatorRef.current = "";
    setTranscript("");
    setErrorMessage(null);

    // Initialize mic audio stream for visualizer
    await setupMicAudio();

    if (!shouldListenRef.current) {
      isStartingRef.current = false;
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = langRef.current;

      recognition.onstart = () => {
        isStartingRef.current = false;
        setIsListening(true);
        setMicPermission("granted");
      };

      recognition.onspeechstart = () => {
        setIsUserSpeaking(true);
        onSpeechStartRef.current?.();
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        let finalized = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item && item[0]) {
            if (item.isFinal) {
              finalized += item[0].transcript + " ";
            } else {
              interim += item[0].transcript;
            }
          }
        }

        if (finalized) {
          finalTranscriptAccumulatorRef.current += finalized;
        }

        const currentDisplay = (finalTranscriptAccumulatorRef.current + interim).trim();
        setTranscript(currentDisplay);

        if (currentDisplay.length > 0) {
          setIsUserSpeaking(true);
          onSpeechStartRef.current?.();
          // Reset silence timer on every new word
          restartSilenceTimer();
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === "no-speech") {
          return;
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          console.warn("[STT] Microphone permission denied or blocked:", event.error);
          shouldListenRef.current = false;
          isStartingRef.current = false;
          setIsListening(false);
          setIsUserSpeaking(false);
          setMicPermission("denied");
          setErrorMessage("Microphone permission was denied. Please allow microphone access in your browser.");
          return;
        }
        if (event.error === "aborted") {
          return;
        }
        console.warn("[STT] Speech recognition event error:", event.error);
      };

      recognition.onend = () => {
        isStartingRef.current = false;
        // Auto-restart only if continuous listening is explicitly requested and permitted
        if (shouldListenRef.current) {
          setTimeout(() => {
            if (shouldListenRef.current) {
              try {
                recognition.start();
              } catch {}
            }
          }, 250);
        } else {
          setIsListening(false);
          setIsUserSpeaking(false);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: unknown) {
      isStartingRef.current = false;
      console.warn("[STT] Failed to start recognition:", err);
      setIsListening(false);
    }
  }, [restartSilenceTimer, setupMicAudio]);

  /**
   * Get user mic volume (0.0 to 1.0) for visualizer pulse when listening.
   */
  const getMicVolume = useCallback((): number => {
    if (!micAnalyserRef.current || !micDataArrayRef.current) return 0;
    micAnalyserRef.current.getByteFrequencyData(micDataArrayRef.current);
    let sum = 0;
    for (let i = 0; i < micDataArrayRef.current.length; i++) {
      sum += micDataArrayRef.current[i];
    }
    const avg = sum / micDataArrayRef.current.length;
    return Math.min(1, avg / 90);
  }, []);

  // Cleanup on unmount
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
    startListening,
    stopListening,
    submitTranscript,
    getMicVolume,
  };
}
