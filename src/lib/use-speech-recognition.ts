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
  onsoundstart?: (() => void) | null;
  onsoundend?: (() => void) | null;
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
  silenceTimeoutMs?: number; // default: 1400ms
  lang?: string;
}

export function useSpeechRecognition({
  onFinalTranscript,
  onSpeechStart,
  silenceTimeoutMs = 1400,
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
  const shouldListenRef = useRef(false);
  const isStartingRef = useRef(false);
  const isUserSpeakingRef = useRef(false);
  const finalTranscriptAccumulatorRef = useRef("");
  const consecutiveErrorsRef = useRef(0);

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
    isUserSpeakingRef.current = false;
  }, [clearSilenceTimer, transcript]);

  const restartSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      clearSilenceTimer();
      const final = (finalTranscriptAccumulatorRef.current + " " + transcript).trim();
      if (final) {
        onFinalTranscriptRef.current?.(final);
        finalTranscriptAccumulatorRef.current = "";
        setTranscript("");
      }
      setIsUserSpeaking(false);
      isUserSpeakingRef.current = false;
    }, silenceTimeoutMsRef.current);
  }, [clearSilenceTimer, transcript]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    isStartingRef.current = false;
    clearSilenceTimer();
    setIsListening(false);
    setIsUserSpeaking(false);
    isUserSpeakingRef.current = false;
    finalTranscriptAccumulatorRef.current = "";
    setTranscript("");

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
  }, [clearSilenceTimer]);

  const startListening = useCallback(async () => {
    if (typeof window !== "undefined") {
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

      try {
        const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
        const recognition = new SpeechRec();

        // Android Google Speech service is single-utterance; continuous causes crashes/dropouts
        recognition.continuous = !isAndroid;
        recognition.interimResults = true;
        recognition.lang = langRef.current;

        recognition.onstart = () => {
          isStartingRef.current = false;
          consecutiveErrorsRef.current = 0;
          setIsListening(true);
          setMicPermission("granted");
        };

        recognition.onspeechstart = () => {
          setIsUserSpeaking(true);
          isUserSpeakingRef.current = true;
          onSpeechStartRef.current?.();
        };

        recognition.onsoundstart = () => {
          setIsUserSpeaking(true);
          isUserSpeakingRef.current = true;
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
            isUserSpeakingRef.current = true;
            onSpeechStartRef.current?.();
            restartSilenceTimer();
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (event.error === "no-speech") {
            consecutiveErrorsRef.current = 0;
            return;
          }
          if (event.error === "aborted") {
            return;
          }
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            console.warn("[STT] Microphone permission denied:", event.error);
            shouldListenRef.current = false;
            isStartingRef.current = false;
            setIsListening(false);
            setIsUserSpeaking(false);
            isUserSpeakingRef.current = false;
            setMicPermission("denied");
            setErrorMessage("Microphone permission was denied. Please allow microphone access in your browser.");
            return;
          }
          if (event.error === "audio-capture") {
            consecutiveErrorsRef.current += 1;
            setErrorMessage("Microphone is currently in use or unavailable.");
            return;
          }
          if (event.error === "network") {
            consecutiveErrorsRef.current += 1;
            console.warn("[STT] Network speech service error:", event.error);
            return;
          }

          consecutiveErrorsRef.current += 1;
          console.warn("[STT] Speech recognition notice:", event.error);
        };

        recognition.onend = () => {
          isStartingRef.current = false;
          recognitionRef.current = null;

          // If speech was captured, submit it
          const accumulated = (finalTranscriptAccumulatorRef.current + " " + transcript).trim();
          if (accumulated) {
            submitTranscript();
            return;
          }

          // Restart listening automatically if still active and no repeated fatal errors
          if (shouldListenRef.current && consecutiveErrorsRef.current < 2) {
            const restartDelay = isAndroid ? 700 : 350;
            setTimeout(() => {
              if (shouldListenRef.current && !recognitionRef.current) {
                try {
                  startListening();
                } catch {}
              }
            }, restartDelay);
          } else {
            setIsListening(false);
            setIsUserSpeaking(false);
            isUserSpeakingRef.current = false;
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err: unknown) {
        isStartingRef.current = false;
        console.warn("[STT] Failed to start recognition:", err);
        setIsListening(false);
      }
    }
  }, [restartSilenceTimer, submitTranscript, transcript]);

  /**
   * Get dynamic volume (0.0 to 1.0) for visualizer pulse when listening.
   * Completely decoupled from getUserMedia to avoid Android hardware microphone contention.
   */
  const getMicVolume = useCallback((): number => {
    if (!shouldListenRef.current) return 0;
    if (isUserSpeakingRef.current) {
      // Lively dynamic speech rhythm wave
      const t = Date.now() / 110;
      return 0.45 + Math.sin(t) * 0.25 + Math.cos(t * 1.7) * 0.15;
    }
    // Gentle ambient presence wave when waiting
    const t = Date.now() / 650;
    return 0.14 + Math.sin(t) * 0.07;
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
