"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AudioAura, { AuraState } from "./AudioAura";

interface EarbudModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  isStreaming: boolean;
  isTyping: boolean;
  onSendMessage: (text: string) => void;
  isPlayingVoice: boolean;
  currentVoiceSentence: string;
  selectedVoice: string;
  onChangeVoice: (voice: string) => void;
  stopVoice: () => void;
  getVoiceVolume: () => number;
  isListening: boolean;
  isUserSpeaking: boolean;
  userTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  getMicVolume: () => number;
}

export default function EarbudModeModal({
  isOpen,
  onClose,
  isStreaming,
  isTyping,
  onSendMessage,
  isPlayingVoice,
  currentVoiceSentence,
  selectedVoice,
  onChangeVoice,
  stopVoice,
  getVoiceVolume,
  isListening,
  isUserSpeaking,
  userTranscript,
  startListening,
  stopListening,
  getMicVolume,
}: EarbudModeModalProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [showVoiceSelect, setShowVoiceSelect] = useState(false);
  const prevSpeakingRef = useRef(false);

  // Auto-start listening when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsMuted(false);
      startListening();
    } else {
      stopListening();
      stopVoice();
    }
  }, [isOpen, startListening, stopListening, stopVoice]);

  // When HER finishes speaking, resume listening if not muted
  useEffect(() => {
    if (prevSpeakingRef.current && !isPlayingVoice && isOpen && !isMuted) {
      startListening();
    }
    prevSpeakingRef.current = isPlayingVoice;
  }, [isPlayingVoice, isOpen, isMuted, startListening]);

  // Determine active aura state
  let auraState: AuraState = "idle";
  if (isPlayingVoice) {
    auraState = "speaking";
  } else if (isTyping || isStreaming) {
    auraState = "thinking";
  } else if (isUserSpeaking || isListening) {
    auraState = "listening";
  }

  // Handle tap anywhere to interrupt
  const handleTapToInterrupt = useCallback(() => {
    if (isPlayingVoice) {
      stopVoice();
      if (!isMuted) {
        startListening();
      }
    }
  }, [isPlayingVoice, stopVoice, isMuted, startListening]);

  // Keyboard controls: Escape to close, Space to interrupt/unmute
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === " " && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        if (isPlayingVoice) {
          handleTapToInterrupt();
        } else {
          // Toggle mute
          if (isMuted) {
            setIsMuted(false);
            startListening();
          } else {
            setIsMuted(true);
            stopListening();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isPlayingVoice, handleTapToInterrupt, isMuted, startListening, stopListening]);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      setIsMuted(false);
      startListening();
    } else {
      setIsMuted(true);
      stopListening();
    }
  }, [isMuted, startListening, stopListening]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#F7F2EA]/95 backdrop-blur-md transition-opacity duration-500 selection:bg-her-accent/20"
      onClick={handleTapToInterrupt}
    >
      {/* ── Top Bar ── */}
      <header
        className="flex items-center justify-between px-6 py-5 sm:px-8 sm:py-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Mode status badge */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-2.5 w-2.5 items-center justify-center">
            <span
              className={`absolute inline-flex h-full w-full rounded-full ${
                isPlayingVoice
                  ? "bg-her-accent animate-ping opacity-75"
                  : isListening
                  ? "bg-emerald-500 animate-pulse opacity-60"
                  : "bg-her-text-muted/40"
              }`}
            />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isPlayingVoice
                  ? "bg-her-accent"
                  : isListening
                  ? "bg-emerald-500"
                  : "bg-her-text-muted/40"
              }`}
            />
          </div>
          <span className="text-[12px] font-medium tracking-[0.14em] text-her-text-muted/70 uppercase">
            Earbud Mode
          </span>
          <span className="hidden sm:inline text-[11px] text-her-text-muted/40 font-light">
            · hands-free
          </span>
        </div>

        {/* Center: Voice Selector */}
        <div className="relative">
          <button
            onClick={() => setShowVoiceSelect((prev) => !prev)}
            className="flex items-center gap-1.5 rounded-full bg-her-surface px-3 py-1.5 text-[11px] tracking-wide text-her-text-muted/80 transition-all hover:bg-her-surface-light hover:text-her-text active:scale-95"
            title="Change HER voice"
          >
            <span>Voice: {selectedVoice.includes("Ava") ? "Ava" : "Jenny"}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3 w-3 opacity-60"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {showVoiceSelect && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl bg-her-surface p-1.5 shadow-xl border border-her-border/40 z-10 animate-in fade-in zoom-in-95">
              <button
                onClick={() => {
                  onChangeVoice("en-US-AvaMultilingualNeural");
                  setShowVoiceSelect(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                  selectedVoice.includes("Ava")
                    ? "bg-her-accent text-white font-medium"
                    : "text-her-text hover:bg-her-surface-light"
                }`}
              >
                <div>
                  <div className="font-medium">Ava</div>
                  <div className="text-[10px] opacity-75">Intimate & Expressive</div>
                </div>
                {selectedVoice.includes("Ava") && <span>✓</span>}
              </button>

              <button
                onClick={() => {
                  onChangeVoice("en-US-JennyNeural");
                  setShowVoiceSelect(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors mt-1 ${
                  selectedVoice.includes("Jenny")
                    ? "bg-her-accent text-white font-medium"
                    : "text-her-text hover:bg-her-surface-light"
                }`}
              >
                <div>
                  <div className="font-medium">Jenny</div>
                  <div className="text-[10px] opacity-75">Warm & Natural</div>
                </div>
                {selectedVoice.includes("Jenny") && <span>✓</span>}
              </button>
            </div>
          )}
        </div>

        {/* Right: Close button */}
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-her-text-muted/60 transition-colors hover:bg-her-surface hover:text-her-text active:scale-95"
          aria-label="Exit Earbud Mode"
          title="Exit Earbud Mode (Esc)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </header>

      {/* ── Center: Visual Aura & Live Transcript ── */}
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        {/* Glowing Ambient Aura */}
        <div className="relative my-4 cursor-pointer">
          <AudioAura
            state={auraState}
            getAudioVolume={getVoiceVolume}
            getMicVolume={getMicVolume}
            size={typeof window !== "undefined" && window.innerWidth < 640 ? 250 : 320}
          />
        </div>

        {/* Subtitle / Status indicator */}
        <div className="mt-4 flex flex-col items-center text-center max-w-lg min-h-[110px]">
          {/* Status Label */}
          <div className="mb-2 text-[11px] font-medium tracking-[0.2em] uppercase text-her-accent/80 transition-all">
            {isPlayingVoice
              ? "HER is speaking"
              : isTyping || isStreaming
              ? "thinking…"
              : isUserSpeaking
              ? "listening to you…"
              : isMuted
              ? "mic paused"
              : isListening
              ? "listening · say anything"
              : "tap mic to speak"}
          </div>

          {/* Transcript / Spoken Text Display */}
          <div className="text-base sm:text-lg font-light leading-relaxed text-her-text/85 transition-opacity duration-300">
            {isPlayingVoice ? (
              <p className="animate-in fade-in italic">
                “{currentVoiceSentence}”
              </p>
            ) : isUserSpeaking && userTranscript ? (
              <p className="text-her-text/70 animate-in fade-in">
                {userTranscript}
              </p>
            ) : !isListening && !isMuted ? (
              <p className="text-her-text-muted/50 text-sm font-normal">
                tap the microphone button below to start voice
              </p>
            ) : (
              <p className="text-her-text-muted/40 text-sm font-normal">
                {isMuted
                  ? "tap mic button below or press Space to unmute"
                  : "speak naturally. HER replies automatically."}
              </p>
            )}
          </div>
        </div>
      </main>

      {/* ── Bottom Controls ── */}
      <footer
        className="flex flex-col items-center justify-center pb-8 pt-4 px-6 sm:pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-6">
          {/* Mic Mute / Unmute Button */}
          <button
            onClick={toggleMute}
            className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 shadow-sm active:scale-95 ${
              isMuted
                ? "bg-rose-100 text-rose-600 hover:bg-rose-200"
                : "bg-her-surface text-her-text hover:bg-her-surface-light"
            }`}
            title={isMuted ? "Unmute microphone (Space)" : "Mute microphone (Space)"}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M10 2a3 3 0 00-3 3v4.293l4.854 4.853A3 3 0 0013 9.293V5a3 3 0 00-3-3zM4.22 3.22a.75.75 0 00-1.06 1.06l13.5 13.5a.75.75 0 101.06-1.06L4.22 3.22zM8.5 13.793l1.5 1.5V17h-2a.75.75 0 000 1.5h4a.75.75 0 000-1.5h-2v-1.707l.793-.793A4.5 4.5 0 015.5 10a.75.75 0 00-1.5 0 6 6 0 005.25 5.95v-2.157z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M10 2a3 3 0 00-3 3v5a3 3 0 006 0V5a3 3 0 00-3-3z" />
                <path d="M5.5 9.5a.75.75 0 00-1.5 0 6 6 0 005.25 5.95V17h-2a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-2v-1.55A6 6 0 0016 9.5a.75.75 0 00-1.5 0 4.5 4.5 0 01-9 0z" />
              </svg>
            )}
          </button>

          {/* Interrupt Button (Visible when HER is speaking) */}
          {isPlayingVoice && (
            <button
              onClick={handleTapToInterrupt}
              className="flex items-center gap-2 rounded-full bg-her-accent/15 px-4 py-2.5 text-xs font-medium text-her-accent transition-all hover:bg-her-accent/25 active:scale-95 animate-in fade-in"
              title="Interrupt HER and speak"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
              </svg>
              <span>tap to interrupt</span>
            </button>
          )}
        </div>

        {/* Tip */}
        <p className="mt-3 text-[11px] text-her-text-muted/40 font-light">
          {isPlayingVoice ? "tap anywhere to pause HER" : "tap outside or press Esc to return to text"}
        </p>
      </footer>
    </div>
  );
}
