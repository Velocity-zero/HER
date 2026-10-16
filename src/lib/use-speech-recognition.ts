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
  silenceTimeoutMs?: number; // default: 2200ms
  lang?: string;
  /** Whether HER is currently speaking or streaming audio (mutes STT to prevent feedback) */
  isPlaybackActive?: boolean;
}

export function useSpeechRecognition({
  onFinalTranscript,
  onSpeechStart,
  silenceTimeoutMs = 2200,
  lang = "en-US",
  isPlaybackActive = false,
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

  const isPlaybackActiveRef = useRef(isPlaybackActive);
  const isGracePeriodRef = useRef(false);

  const speechStartTimeRef = useRef(0);
  const speechPauseCountRef = useRef(0);
  const energySamplesRef = useRef<number[]>([]);

  const recognitionRef = useRef<IWindowSpeechRecognition | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shouldListenRef = useRef(false);
  const isStartingRef = useRef(false);
  const isUserSpeakingRef = useRef(false);
  const finalTranscriptAccumulatorRef = useRef("");
  const consecutiveErrorsRef = useRef(0);

  // Sync playback active state and manage acoustic echo grace period
  useEffect(() => {
    isPlaybackActiveRef.current = isPlaybackActive;
    if (isPlaybackActive) {
      isGracePeriodRef.current = true;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setIsUserSpeaking(false);
      isUserSpeakingRef.current = false;
    } else {
      // 400ms grace window so speaker reverb / decay doesn't trip speech detection
      const timer = setTimeout(() => {
        isGracePeriodRef.current = false;
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isPlaybackActive]);

  // Check Web Speech API support & initial permission query on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      if (!hasSpeech) {
        setMicPermission("unsupported");
        setErrorMessage("Speech recognition is not supported in this browser");
        return;
      }

      // Check existing permission if Permissions API is supported
      if (navigator.permissions && navigator.permissions.query) {
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
    }
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Submit finalized transcript with emotion analysis and reset buffer
  const submitTranscript = useCallback(() => {
    clearSilenceTimer();
    const final = (finalTranscriptAccumulatorRef.current + " " + transcript).trim();
    
    // Ignore empty utterances or pure punctuation / phantom clicks
    if (final.length >= 2 && !/^[\s.,!?'-]+$/.test(final)) {
      const durationMs = Math.max(400, Date.now() - (speechStartTimeRef.current || Date.now()));
      const words = final.split(/\s+/).filter(Boolean);
      const wpm = Math.round((words.length / (durationMs / 60000)) || 120);

      const avgEnergy = energySamplesRef.current.length > 0
        ? energySamplesRef.current.reduce((a, b) => a + b, 0) / energySamplesRef.current.length
        : 0.5;
      const energy: "soft" | "intense" | "balanced" =
        avgEnergy < 0.28 ? "soft" : avgEnergy > 0.72 ? "intense" : "balanced";

      const pace: "slow" | "fast" | "moderate" =
        wpm > 175 ? "fast" : wpm < 90 ? "slow" : "moderate";

      let tone: VoiceEmotion["tone"] = "casual";
      if (speechPauseCountRef.current >= 2 || (pace === "slow" && energy === "soft")) {
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
        pauseCount: speechPauseCountRef.current,
        wpm,
        summary: `${tone} tone, ${pace} pace, ${energy} energy`,
      };

      onFinalTranscriptRef.current?.(final, emotion);
      finalTranscriptAccumulatorRef.current = "";
      setTranscript("");
    }

    speechStartTimeRef.current = 0;
    speechPauseCountRef.current = 0;
    energySamplesRef.current = [];
    setIsUserSpeaking(false);
    isUserSpeakingRef.current = false;
  }, [clearSilenceTimer, transcript]);

  const restartSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    speechPauseCountRef.current += 1;
    silenceTimerRef.current = setTimeout(() => {
      submitTranscript();
    }, silenceTimeoutMsRef.current);
  }, [clearSilenceTimer, submitTranscript]);

  /**
   * Explicitly requests native browser microphone permission via getUserMedia,
   * then immediately releases the tracks so the hardware is free for SpeechRecognition.
   * This is required on mobile browsers to show the native system "Allow Microphone" dialog.
   */
  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicPermission("unsupported");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // CRITICAL: Immediately stop all tracks to release hardware exclusive lock!
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission("granted");
      setErrorMessage(null);
      return true;
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name;
      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        setMicPermission("denied");
        setErrorMessage("Microphone permission denied. Please allow microphone in browser settings.");
      } else {
        setErrorMessage("Unable to access microphone.");
      }
      return false;
    }
  }, []);

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
          if (isPlaybackActiveRef.current || isGracePeriodRef.current) return;
          if (!speechStartTimeRef.current) speechStartTimeRef.current = Date.now();
          setIsUserSpeaking(true);
          isUserSpeakingRef.current = true;
          onSpeechStartRef.current?.();
        };

        recognition.onsoundstart = () => {
          if (isPlaybackActiveRef.current || isGracePeriodRef.current) return;
          if (!speechStartTimeRef.current) speechStartTimeRef.current = Date.now();
          setIsUserSpeaking(true);
          isUserSpeakingRef.current = true;
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          if (isPlaybackActiveRef.current || isGracePeriodRef.current) {
            // Echo cancellation: ignore audio while HER is speaking or during post-speech grace period
            return;
          }

          if (!speechStartTimeRef.current) speechStartTimeRef.current = Date.now();
          energySamplesRef.current.push(getMicVolume());

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
          }

          // In phone call mode: keep connection alive smoothly
          if (shouldListenRef.current && consecutiveErrorsRef.current < 4) {
            const restartDelay = isAndroid ? 450 : 250;
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
  }, [micPermission, requestMicPermission, restartSilenceTimer, submitTranscript, transcript]);

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
    requestMicPermission,
    startListening,
    stopListening,
    submitTranscript,
    getMicVolume,
  };
}
