"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AudioAura, { AuraState } from "./AudioAura";
import type { Message } from "@/lib/types";
import type { MicPermissionState } from "@/lib/use-speech-recognition";

interface PhoneCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: Message[];
  isStreaming: boolean;
  isTyping: boolean;
  onSendMessage: (text: string) => void;
  isPlayingVoice: boolean;
  currentVoiceSentence: string;
  selectedVoice: string;
  onChangeVoice: (voice: string) => void;
  stopVoice: () => void;
  onSpeakText?: (text: string) => void;
  getVoiceVolume: () => number;
  isListening: boolean;
  isUserSpeaking: boolean;
  userTranscript: string;
  micPermission: MicPermissionState;
  errorMessage: string | null;
  onRequestMicPermission?: () => Promise<boolean>;
  startListening: () => void;
  stopListening: () => void;
  submitTranscript: () => void;
  getMicVolume: () => number;
}

export default function PhoneCallModal({
  isOpen,
  onClose,
  messages,
  isStreaming,
  isTyping,
  onSendMessage,
  isPlayingVoice,
  currentVoiceSentence,
  selectedVoice,
  onChangeVoice,
  stopVoice,
  onSpeakText,
  getVoiceVolume,
  isListening,
  isUserSpeaking,
  userTranscript,
  micPermission,
  errorMessage,
  onRequestMicPermission,
  startListening,
  stopListening,
  submitTranscript,
  getMicVolume,
}: PhoneCallModalProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [showVoiceSelect, setShowVoiceSelect] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showKeypad, setShowKeypad] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState<"connecting" | "connected">("connecting");

  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Manage call connection & timer lifecycle
  useEffect(() => {
    if (isOpen) {
      setIsMuted(false);
      setCallDuration(0);
      setCallStatus("connecting");

      // Short connection ramp (400ms) to feel like a real phone call connecting
      const connTimer = setTimeout(() => {
        setCallStatus("connected");
      }, 500);

      // Start duration counter
      durationTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);

      // Start microphone ONCE on call connect
      if (micPermission === "granted") {
        startListening();
      }

      return () => {
        clearTimeout(connTimer);
        if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      };
    } else {
      setCallDuration(0);
      setCallStatus("connecting");
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      stopListening();
      stopVoice();
    }
  }, [isOpen]); // NOTE: Intentionally not depending on startListening to prevent multiple calls!

  // Format call duration MM:SS
  const formatDuration = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Determine active aura visual state
  let auraState: AuraState = "idle";
  if (isPlayingVoice) {
    auraState = "speaking";
  } else if (isTyping || isStreaming) {
    auraState = "thinking";
  } else if (isUserSpeaking || isListening) {
    auraState = "listening";
  }

  // Handle tap anywhere on background/aura to interrupt Samantha
  const handleTapToInterrupt = useCallback(() => {
    if (isPlayingVoice) {
      stopVoice();
    }
  }, [isPlayingVoice, stopVoice]);

  // Keyboard shortcuts: Escape to end call, Space to mute/unmute or interrupt
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
          toggleMute();
        }
      } else if (e.key === "Enter" && userTranscript.trim() && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        submitTranscript();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isPlayingVoice, handleTapToInterrupt, userTranscript, submitTranscript]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        stopListening();
      } else {
        startListening();
      }
      return next;
    });
  }, [startListening, stopListening]);

  const handleSendKeypadText = useCallback(() => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setTextInput("");
    setShowKeypad(false);
  }, [textInput, onSendMessage]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#140F0D] text-[#F5EDE6] select-none transition-opacity duration-300 overflow-hidden"
      onClick={handleTapToInterrupt}
    >
      {/* ── Ambient Warm Lighting Glow (inspired by Spike Jonze's HER) ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-gradient-to-tr from-[#C95D4A]/15 via-[#E68A6E]/10 to-transparent blur-[120px]" />
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[350px] h-[200px] rounded-full bg-[#B34332]/10 blur-[90px]" />
      </div>

      {/* ── Top Call Header ── */}
      <header
        className="relative z-10 flex items-center justify-between px-6 pt-7 pb-2 sm:px-10 sm:pt-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Minimize / Return to Chat timeline */}
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all active:scale-95"
          title="Minimize call to chat (Esc)"
          aria-label="Minimize call"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Center: Contact Info & Call Status */}
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-light tracking-[0.18em] uppercase text-white/95 font-serif">
              Samantha
            </h1>
            <span className="flex h-2 w-2 rounded-full bg-[#E06D53] animate-pulse" />
          </div>

          <div className="mt-1 flex items-center gap-2 text-xs font-light tracking-wider text-white/50">
            {callStatus === "connecting" ? (
              <span className="text-[#E0856E] animate-pulse">calling…</span>
            ) : (
              <>
                <span className="font-mono text-white/80">{formatDuration(callDuration)}</span>
                <span>·</span>
                <span className="text-[#E06D53]/90 font-medium">
                  {isPlayingVoice
                    ? "speaking"
                    : isTyping || isStreaming
                    ? "thinking"
                    : isMuted
                    ? "muted"
                    : isUserSpeaking
                    ? "listening"
                    : "connected"}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: Voice Settings Popover */}
        <div className="relative">
          <button
            onClick={() => setShowVoiceSelect((prev) => !prev)}
            className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-all active:scale-95"
            title="Switch Samantha's voice"
          >
            <span className="text-[11px] font-medium tracking-wide">
              {selectedVoice.includes("Ava") ? "Ava" : "Jenny"}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 opacity-60">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>

          {showVoiceSelect && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-[#201815] p-2 shadow-2xl border border-white/10 z-20 animate-in fade-in zoom-in-95 backdrop-blur-xl">
              <button
                onClick={() => {
                  onChangeVoice("en-US-AvaMultilingualNeural");
                  setShowVoiceSelect(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                  selectedVoice.includes("Ava")
                    ? "bg-[#C95D4A] text-white font-medium"
                    : "text-white/80 hover:bg-white/5"
                }`}
              >
                <div>
                  <div className="font-medium">Ava (Neural)</div>
                  <div className="text-[10px] opacity-75">Intimate, breathy & expressive</div>
                </div>
                {selectedVoice.includes("Ava") && <span>✓</span>}
              </button>

              <button
                onClick={() => {
                  onChangeVoice("en-US-JennyNeural");
                  setShowVoiceSelect(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors mt-1 ${
                  selectedVoice.includes("Jenny")
                    ? "bg-[#C95D4A] text-white font-medium"
                    : "text-white/80 hover:bg-white/5"
                }`}
              >
                <div>
                  <div className="font-medium">Jenny (Neural)</div>
                  <div className="text-[10px] opacity-75">Warm, clear & conversational</div>
                </div>
                {selectedVoice.includes("Jenny") && <span>✓</span>}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Main Call Center: Luminous Breathing Audio Aura & Live Subtitles ── */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-w-xl mx-auto w-full">
        {/* Permission Request Needed Notice */}
        {micPermission === "prompt" && (
          <div
            className="mb-4 max-w-sm rounded-2xl bg-white/10 border border-white/15 p-4 text-center backdrop-blur-md animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-medium text-sm text-[#F0947D]">Microphone Access Needed</p>
            <p className="text-xs text-white/70 mt-1">
              Tap below so Samantha can hear your voice on the call.
            </p>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                const ok = await onRequestMicPermission?.();
                if (ok) startListening();
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#C95D4A] px-5 py-2 text-xs font-medium text-white shadow-lg hover:bg-[#B34332] active:scale-95 transition-all"
            >
              🎙️ Allow Microphone
            </button>
          </div>
        )}

        {/* Permission Blocked Notice */}
        {micPermission === "denied" && (
          <div
            className="mb-4 max-w-sm rounded-2xl bg-rose-950/40 border border-rose-500/30 p-4 text-center text-xs text-rose-200 backdrop-blur-md animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-rose-200">Microphone Blocked</p>
            <p className="text-[11px] text-rose-300/80 mt-1">
              Please allow microphone access in your browser address bar to speak on the call.
            </p>
            <button
              type="button"
              onClick={() => setShowKeypad(true)}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs text-white hover:bg-white/20 transition-all"
            >
              ⌨️ Type to Speak
            </button>
          </div>
        )}

        {/* The Iconic Breathing Audio Aura */}
        <div className="relative my-2 sm:my-4 cursor-pointer active:scale-95 transition-transform duration-300">
          <AudioAura
            state={auraState}
            getAudioVolume={getVoiceVolume}
            getMicVolume={getMicVolume}
            size={280}
          />
        </div>

        {/* Live Subtitles / Spoken Captions */}
        {showCaptions && (
          <div className="mt-3 min-h-[90px] max-w-md w-full text-center flex flex-col items-center justify-center px-4">
            {isPlayingVoice ? (
              <p className="text-base sm:text-lg font-light text-white/95 leading-relaxed italic animate-in fade-in font-serif">
                “{currentVoiceSentence}”
              </p>
            ) : userTranscript ? (
              <div className="animate-in fade-in flex flex-col items-center gap-2">
                <p className="text-base sm:text-lg font-normal text-[#F2B5A5] leading-relaxed">
                  “{userTranscript}”
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    submitTranscript();
                  }}
                  className="rounded-full bg-[#C95D4A]/80 hover:bg-[#C95D4A] px-3.5 py-1 text-[11px] text-white/90 shadow transition-all active:scale-95"
                >
                  Send ↵
                </button>
              </div>
            ) : isListening && !isMuted ? (
              <p className="text-xs sm:text-sm font-light text-white/40 tracking-wide">
                speak freely · Samantha is listening
              </p>
            ) : isMuted ? (
              <p className="text-xs sm:text-sm font-light text-rose-300/60 tracking-wide">
                microphone muted · tap unmute below
              </p>
            ) : (
              <p className="text-xs sm:text-sm font-light text-white/40 tracking-wide">
                connected
              </p>
            )}
          </div>
        )}
      </main>

      {/* ── Call Controls Bar (Phone Call Keypad Grid) ── */}
      <footer
        className="relative z-10 flex flex-col items-center px-6 pb-8 pt-3 max-w-md mx-auto w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Whisper text composer for quiet environments */}
        {showKeypad && (
          <div className="mb-4 w-full animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 backdrop-blur-xl shadow-xl">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSendKeypadText();
                  }
                }}
                placeholder="type a note to Samantha…"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSendKeypadText}
                disabled={!textInput.trim()}
                className="rounded-full bg-[#C95D4A] px-3.5 py-1 text-xs font-medium text-white shadow hover:bg-[#B34332] transition-all disabled:opacity-30"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {/* Circular Action Buttons */}
        <div className="flex items-center justify-center gap-7 sm:gap-9 mb-4">
          {/* 1. Mute Button */}
          <button
            type="button"
            onClick={toggleMute}
            className={`flex flex-col items-center gap-1.5 transition-all active:scale-90 ${
              isMuted ? "text-rose-400" : "text-white/75 hover:text-white"
            }`}
            title={isMuted ? "Unmute microphone (Space)" : "Mute microphone (Space)"}
          >
            <div
              className={`flex h-13 w-13 items-center justify-center rounded-full border transition-all ${
                isMuted
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-400 ring-4 ring-rose-500/10"
                  : "bg-white/10 border-white/15 hover:bg-white/15"
              }`}
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
            </div>
            <span className="text-[11px] font-light tracking-wider opacity-75">
              {isMuted ? "unmute" : "mute"}
            </span>
          </button>

          {/* 2. Keypad / Chat toggle */}
          <button
            type="button"
            onClick={() => setShowKeypad((prev) => !prev)}
            className={`flex flex-col items-center gap-1.5 transition-all active:scale-90 ${
              showKeypad ? "text-[#E0856E]" : "text-white/75 hover:text-white"
            }`}
            title="Type a message instead"
          >
            <div
              className={`flex h-13 w-13 items-center justify-center rounded-full border transition-all ${
                showKeypad
                  ? "bg-[#C95D4A]/25 border-[#C95D4A]/50 text-[#E0856E] ring-4 ring-[#C95D4A]/15"
                  : "bg-white/10 border-white/15 hover:bg-white/15"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6.414l-2.707 2.707A1 1 0 0 1 2 16V5z" />
              </svg>
            </div>
            <span className="text-[11px] font-light tracking-wider opacity-75">
              keypad
            </span>
          </button>

          {/* 3. Live Captions (CC) toggle */}
          <button
            type="button"
            onClick={() => setShowCaptions((prev) => !prev)}
            className={`flex flex-col items-center gap-1.5 transition-all active:scale-90 ${
              showCaptions ? "text-white/90" : "text-white/40 hover:text-white/70"
            }`}
            title="Toggle live captions"
          >
            <div
              className={`flex h-13 w-13 items-center justify-center rounded-full border transition-all ${
                showCaptions
                  ? "bg-white/20 border-white/30 text-white"
                  : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
              }`}
            >
              <span className="text-xs font-bold tracking-tight">CC</span>
            </div>
            <span className="text-[11px] font-light tracking-wider opacity-75">
              captions
            </span>
          </button>
        </div>

        {/* ── Prominent Circular Red End Call Button ── */}
        <div className="mt-2 flex flex-col items-center">
          <button
            type="button"
            onClick={onClose}
            className="group flex h-16 w-16 items-center justify-center rounded-full bg-[#D1392B] hover:bg-[#BA2F22] text-white shadow-2xl shadow-[#D1392B]/40 ring-4 ring-[#D1392B]/20 active:scale-95 transition-all duration-200"
            title="End phone call (Esc)"
            aria-label="End call"
          >
            {/* Phone receiver handset facing downwards (hangup) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-7 w-7 transition-transform group-hover:scale-105"
            >
              <path d="M4.5 4.5a3 3 0 00-3 3v1a16.5 16.5 0 0016.5 16.5h1a3 3 0 003-3v-3.5a1.5 1.5 0 00-1.12-1.455l-4.5-1.125a1.5 1.5 0 00-1.59.575l-1.42 1.893a12.036 12.036 0 01-5.773-5.773l1.893-1.42a1.5 1.5 0 00.575-1.59l-1.125-4.5A1.5 1.5 0 007.5 4.5H4.5z" />
            </svg>
          </button>
          <span className="mt-2 text-[11px] font-light tracking-widest uppercase text-white/40">
            End Call
          </span>
        </div>
      </footer>
    </div>
  );
}
