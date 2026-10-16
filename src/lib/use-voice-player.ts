"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { VoicePlayer, VoicePlayerOptions } from "./voice-player";
import { SentenceChunker } from "./sentence-chunker";

export interface UseVoicePlayerOptions {
  voice?: string;
  onSentenceStart?: (sentence: string) => void;
  onPlaybackEnd?: () => void;
}

export function useVoicePlayer(options: UseVoicePlayerOptions = {}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSentence, setCurrentSentence] = useState("");
  const [selectedVoice, setSelectedVoiceState] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("her-selected-voice");
      if (saved) return saved;
    }
    return options.voice || "en-US-AvaMultilingualNeural";
  });

  const playerRef = useRef<VoicePlayer | null>(null);
  const chunkerRef = useRef<SentenceChunker | null>(null);

  const setSelectedVoice = useCallback((voice: string) => {
    setSelectedVoiceState(voice);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("her-selected-voice", voice);
      } catch {}
    }
    playerRef.current?.updateOptions({ voice });
  }, []);

  // Initialize player and chunker once
  useEffect(() => {
    const player = new VoicePlayer({
      voice: selectedVoice,
      onSentenceStart: (sentence) => {
        setIsPlaying(true);
        setCurrentSentence(sentence);
        options.onSentenceStart?.(sentence);
      },
      onSentenceEnd: () => {
        // Keeps current sentence visible until next one starts or ends
      },
      onPlaybackEnd: () => {
        setIsPlaying(false);
        setCurrentSentence("");
        options.onPlaybackEnd?.();
      },
    });

    const chunker = new SentenceChunker((sentence) => {
      player.enqueue(sentence);
    });

    playerRef.current = player;
    chunkerRef.current = chunker;

    return () => {
      player.stop();
      playerRef.current = null;
      chunkerRef.current = null;
    };
  }, []);

  // Update voice option when changed
  useEffect(() => {
    playerRef.current?.updateOptions({ voice: selectedVoice });
  }, [selectedVoice]);

  /**
   * Feed a chunk of streamed text from LLM response.
   */
  const feedChunk = useCallback((token: string) => {
    chunkerRef.current?.push(token);
  }, []);

  /**
   * Flush any buffered text when the LLM stream is finished.
   */
  const finishFeeding = useCallback(() => {
    chunkerRef.current?.flush();
  }, []);

  /**
   * Stop speaking and clear the queue immediately.
   */
  const stopSpeaking = useCallback(() => {
    chunkerRef.current?.reset();
    playerRef.current?.stop();
    setIsPlaying(false);
    setCurrentSentence("");
  }, []);

  /**
   * Speak a complete message or text string directly.
   */
  const speakText = useCallback((text: string) => {
    stopSpeaking();
    if (!text.trim()) return;

    // Split text into sentences using chunker
    const chunker = new SentenceChunker((sentence) => {
      playerRef.current?.enqueue(sentence);
    });
    chunker.push(text);
    chunker.flush();
  }, [stopSpeaking]);

  /**
   * Get real-time audio volume (0.0 to 1.0).
   */
  const getVolume = useCallback((): number => {
    return playerRef.current?.getVolume() || 0;
  }, []);

  /**
   * Get real-time frequency data bins.
   */
  const getFrequencyData = useCallback((): Uint8Array | null => {
    return playerRef.current?.getFrequencyData() || null;
  }, []);

  /**
   * Unlock AudioContext on user gesture.
   */
  const unlockAudio = useCallback(() => {
    playerRef.current?.unlockAudio();
  }, []);

  return {
    isPlaying,
    currentSentence,
    selectedVoice,
    setSelectedVoice,
    feedChunk,
    finishFeeding,
    speakText,
    stopSpeaking,
    unlockAudio,
    getVolume,
    getFrequencyData,
  };
}
