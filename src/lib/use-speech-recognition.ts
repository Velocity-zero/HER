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
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef<IWindowSpeechRecognition | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micDataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const shouldListenRef = useRef(false);
  const finalTranscriptAccumulatorRef = useRef("");

  // Check support on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      setIsSupported(hasSpeech);
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

  // Setup mic audio stream for visualizer frequency analysis
  const setupMicAudio = useCallback(async () => {
    try {
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      micAudioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);

      micAnalyserRef.current = analyser;
      micDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn("[STT] Microphone audio visualizer could not be initialized:", err);
    }
  }, []);

  // Submit finalized transcript and reset buffer
  const submitTranscript = useCallback(() => {
    clearSilenceTimer();
    const final = finalTranscriptAccumulatorRef.current.trim();
    if (final) {
      onFinalTranscript?.(final);
      finalTranscriptAccumulatorRef.current = "";
      setTranscript("");
    }
    setIsUserSpeaking(false);
  }, [clearSilenceTimer, onFinalTranscript]);

  const restartSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      submitTranscript();
    }, silenceTimeoutMs);
  }, [clearSilenceTimer, silenceTimeoutMs, submitTranscript]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
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
      console.warn("[STT] SpeechRecognition not supported in this browser");
      return;
    }

    // Stop any existing instance
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    shouldListenRef.current = true;
    finalTranscriptAccumulatorRef.current = "";
    setTranscript("");
    setIsListening(true);

    await setupMicAudio();

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onspeechstart = () => {
      setIsUserSpeaking(true);
      onSpeechStart?.();
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
        onSpeechStart?.();
        // Reset silence timer on every new speech token
        restartSilenceTimer();
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech") {
        // Normal silence timeout from Web Speech engine, keep listening
        return;
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        // Microphone permission denied or unavailable in sandbox
        console.warn("[STT] Microphone permission denied or unavailable");
        shouldListenRef.current = false;
        setIsListening(false);
        setIsUserSpeaking(false);
        return;
      }
      if (event.error === "aborted") {
        return;
      }
      console.warn("[STT] Speech recognition event error:", event.error);
    };

    recognition.onend = () => {
      // Auto-restart if we are still supposed to be listening (handles mobile speech engines)
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch {
          // Can happen if started too rapidly
          setTimeout(() => {
            if (shouldListenRef.current) {
              try {
                recognition.start();
              } catch {}
            }
          }, 300);
        }
      } else {
        setIsListening(false);
        setIsUserSpeaking(false);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.error("[STT] Failed to start recognition:", err);
      setIsListening(false);
    }
  }, [lang, onSpeechStart, restartSilenceTimer, setupMicAudio]);

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
    return Math.min(1, avg / 100);
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
    isSupported,
    startListening,
    stopListening,
    getMicVolume,
  };
}
