"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AudioAura, { AuraState } from "./AudioAura";
import type { Message } from "@/lib/types";
import type { MicPermissionState } from "@/lib/use-speech-recognition";

interface EarbudModeModalProps {
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

export default function EarbudModeModal({
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
}: EarbudModeModalProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [showVoiceSelect, setShowVoiceSelect] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const prevSpeakingRef = useRef(false);

  // Poll mic volume smoothly for the live UI soundwave bars (only when listening)
  useEffect(() => {
    if (!isOpen || !isListening || isPlayingVoice) {
      setMicLevel(0);
      return;
    }
    const interval = setInterval(() => {
      const vol = getMicVolume();
      setMicLevel(vol);
    }, 80);
    return () => clearInterval(interval);
  }, [isOpen, isListening, isPlayingVoice, getMicVolume]);

  // Manage start/stop listening when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setIsMuted(false);
      if (micPermission === "granted") {
        startListening();
      }
    } else {
      stopListening();
      stopVoice();
    }
  }, [isOpen, micPermission, startListening, stopListening, stopVoice]);

  // When HER finishes speaking, resume listening automatically
  useEffect(() => {
    if (prevSpeakingRef.current && !isPlayingVoice && isOpen && !isMuted) {
      startListening();
    }
    prevSpeakingRef.current = isPlayingVoice;
  }, [isPlayingVoice, isOpen, isMuted]);

  // Determine active aura state
  let auraState: AuraState = "idle";
  if (isPlayingVoice) {
    auraState = "speaking";
  } else if (isTyping || isStreaming) {
    auraState = "thinking";
  } else if (isUserSpeaking || isListening) {
    auraState = "listening";
  }

  // Handle tap anywhere to interrupt HER
  const handleTapToInterrupt = useCallback(() => {
    if (isPlayingVoice) {
      stopVoice();
      if (!isMuted) {
        startListening();
      }
    }
  }, [isPlayingVoice, stopVoice, isMuted, startListening]);

  // Keyboard controls: Escape to close, Space to interrupt/unmute, Enter to send
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
      } else if (e.key === "Enter" && userTranscript.trim() && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        submitTranscript();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isPlayingVoice, handleTapToInterrupt, isMuted, startListening, stopListening, userTranscript, submitTranscript]);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      setIsMuted(false);
      startListening();
    } else {
      setIsMuted(true);
      stopListening();
    }
  }, [isMuted, startListening, stopListening]);

  const handleManualSendText = useCallback(() => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setTextInput("");
    setShowTextInput(false);
  }, [textInput, onSendMessage]);

  if (!isOpen) return null;

  // Find the most recent assistant message from the ongoing text conversation
  const recentAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content && m.content !== "(shared a photo)");

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#F7F2EA]/95 backdrop-blur-md transition-opacity duration-300 selection:bg-her-accent/20"
      onClick={handleTapToInterrupt}
    >
      {/* ── Top Bar ── */}
      <header
        className="flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5"
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
            · ongoing conversation
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
            <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl bg-her-surface p-1.5 shadow-xl border border-her-border/40 z-10 animate-in fade-in zoom-in-95">
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
                  <div className="text-[10px] opacity-75">Intimate & Expressive (Neural)</div>
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
                  <div className="text-[10px] opacity-75">Warm & Natural (Neural)</div>
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

      {/* ── Center: Ongoing Context, Visual Aura & Live Transcript ── */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 overflow-y-auto w-full max-w-lg mx-auto py-1">
        {/* Ongoing Conversation Context Pill */}
        {recentAssistantMessage && !isPlayingVoice && (
          <div
            className="mb-2 max-w-md w-full animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-her-surface/50 px-3.5 py-2 border border-her-border/25 shadow-[0_1px_4px_rgba(180,140,110,0.04)]">
              <div className="min-w-0 flex-1">
                <span className="block text-[9px] uppercase tracking-[0.14em] font-semibold text-her-accent/70">
                  last from her
                </span>
                <p className="truncate text-xs text-her-text-muted/80 italic">
                  “{recentAssistantMessage.content}”
                </p>
              </div>
              {onSpeakText && (
                <button
                  type="button"
                  onClick={() => onSpeakText(recentAssistantMessage.content)}
                  className="shrink-0 flex items-center gap-1 rounded-full bg-her-accent/10 px-2.5 py-1 text-[10px] font-medium text-her-accent hover:bg-her-accent/20 transition-all active:scale-95"
                  title="Replay HER's last message"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-2.5 w-2.5">
                    <path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z" />
                  </svg>
                  <span>listen</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Glowing Ambient Aura */}
        <div className="relative my-1 sm:my-2 cursor-pointer">
          <AudioAura
            state={auraState}
            getAudioVolume={getVoiceVolume}
            getMicVolume={getMicVolume}
            size={210}
          />
        </div>

        {/* Permission Request Needed Notice */}
        {micPermission === "prompt" && (
          <div
            className="my-2 max-w-sm rounded-2xl bg-her-surface/90 border border-her-border/40 p-3.5 text-center shadow-md animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-medium text-xs text-her-accent">Microphone Access Needed</p>
            <p className="text-[11px] text-her-text-muted/70 mt-1">
              Tap below so HER can hear your voice hands-free.
            </p>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                const ok = await onRequestMicPermission?.();
                if (ok) startListening();
              }}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-her-accent px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-her-accent-hover active:scale-95 transition-all"
            >
              🎙️ Allow Microphone
            </button>
          </div>
        )}

        {/* Permission Warning Notice (if blocked) */}
        {micPermission === "denied" && (
          <div
            className="my-2 max-w-sm rounded-2xl bg-amber-50 border border-amber-200/80 p-3.5 text-center text-xs text-amber-900 shadow-sm animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-amber-900">Microphone Permission Blocked</p>
            <p className="text-[11px] text-amber-800/80 mt-1 leading-relaxed">
              In Chrome address bar, tap the lock or tune icon → Permissions → switch <strong>Microphone</strong> to <strong>Allow</strong>.
            </p>
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const ok = await onRequestMicPermission?.();
                  if (ok) startListening();
                }}
                className="rounded-full bg-amber-200/80 px-3 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-300 transition-colors"
              >
                🔄 Retry Permission
              </button>
              <button
                type="button"
                onClick={() => setShowTextInput(true)}
                className="rounded-full bg-her-surface px-3 py-1 text-[11px] font-medium text-her-text hover:bg-her-surface-light border border-her-border/40 transition-colors"
              >
                ⌨️ Type Instead
              </button>
            </div>
          </div>
        )}

        {/* Unsupported Notice (if browser has no SpeechRecognition) */}
        {micPermission === "unsupported" && (
          <div
            className="my-2 max-w-sm rounded-xl bg-her-surface border border-her-border/40 p-3 text-center text-xs text-her-text-muted animate-in fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-medium text-her-text">Browser speech not available</p>
            <p className="text-[11px] mt-0.5">
              Voice recognition works best on Chrome or Edge.
            </p>
            <button
              type="button"
              onClick={() => setShowTextInput(true)}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-her-accent/15 px-3 py-1 text-[11px] font-medium text-her-accent hover:bg-her-accent/25 transition-colors"
            >
              ⌨️ type a message instead
            </button>
          </div>
        )}

        {/* Live Status and Soundwave Level Indicator */}
        <div className="mt-2 flex flex-col items-center text-center max-w-lg min-h-[105px]">
          {/* Status Label + Reactive Waveform Bars */}
          <div className="mb-2 flex items-center justify-center gap-2">
            <span className="text-[11px] font-medium tracking-[0.2em] uppercase text-her-accent/80 transition-all">
              {isPlayingVoice
                ? "HER is speaking"
                : isTyping || isStreaming
                ? "thinking…"
                : isUserSpeaking
                ? "hearing you speak…"
                : isMuted
                ? "mic muted"
                : isListening
                ? "listening to you"
                : "mic standby"}
            </span>

            {/* Soundwave animation bars (moving to mic volume) */}
            {isListening && !isPlayingVoice && !isMuted && (
              <div className="flex items-center gap-0.5 h-3 ml-1">
                {[0.4, 0.8, 1.2, 0.7, 0.5].map((scale, i) => (
                  <span
                    key={i}
                    className="w-[2px] rounded-full bg-emerald-500/80 transition-all duration-75"
                    style={{
                      height: `${Math.max(3, (micLevel * 18 * scale) + (isUserSpeaking ? 4 : 1))}px`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Transcript / Spoken Text Display */}
          <div className="text-base sm:text-lg font-light leading-relaxed text-her-text/85 transition-opacity duration-200">
            {isPlayingVoice ? (
              <p className="animate-in fade-in italic">
                “{currentVoiceSentence}”
              </p>
            ) : userTranscript ? (
              <div className="animate-in fade-in flex flex-col items-center gap-2">
                <p className="text-her-text font-normal">
                  “{userTranscript}”
                </p>
                {/* Instant Send Button (no need to wait for 1.5s silence) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    submitTranscript();
                  }}
                  className="rounded-full bg-her-accent px-4 py-1.5 text-xs text-white shadow-sm hover:bg-her-accent-hover active:scale-95 transition-all"
                >
                  Send Now ↵
                </button>
              </div>
            ) : isListening && !isMuted ? (
              <p className="text-her-text-muted/50 text-sm font-normal">
                speak freely. your reply continues this conversation naturally.
              </p>
            ) : isMuted ? (
              <p className="text-her-text-muted/40 text-sm font-normal">
                mic is paused. tap the mic button below or press Space to resume.
              </p>
            ) : (
              <p className="text-her-text-muted/50 text-sm font-normal">
                tap the mic button below to start talking
              </p>
            )}
          </div>
        </div>
      </main>

      {/* ── Bottom Controls ── */}
      <footer
        className="flex flex-col items-center justify-center pb-5 pt-2 px-4 sm:pb-7 w-full max-w-lg mx-auto shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Optional Whisper Text Field for noisy environments */}
        {showTextInput && (
          <div
            className="mb-4 w-full animate-in fade-in slide-in-from-bottom-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 rounded-full border border-her-border/45 bg-her-composer px-4 py-2 shadow-md">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleManualSendText();
                  }
                }}
                placeholder="type to reply hands-free…"
                className="flex-1 bg-transparent text-xs sm:text-sm text-her-text outline-none placeholder:text-her-text-muted/40"
                autoFocus
              />
              <button
                type="button"
                onClick={handleManualSendText}
                disabled={!textInput.trim()}
                className="rounded-full bg-her-accent px-3.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-her-accent-hover transition-all disabled:opacity-30"
              >
                send
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-6">
          {/* Main Microphone Button */}
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              if (isPlayingVoice) {
                handleTapToInterrupt();
              } else if (userTranscript.trim()) {
                submitTranscript();
              } else if (micPermission !== "granted") {
                const ok = await onRequestMicPermission?.();
                if (ok) startListening();
              } else if (isListening) {
                toggleMute();
              } else {
                startListening();
              }
            }}
            className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 shadow-lg active:scale-90 ${
              isPlayingVoice
                ? "bg-her-accent text-white shadow-her-accent/30 ring-4 ring-her-accent/20"
                : isUserSpeaking
                ? "bg-her-accent text-white shadow-her-accent/40 ring-4 ring-her-accent/30 animate-pulse"
                : isListening
                ? "bg-emerald-500 text-white shadow-emerald-500/30 ring-4 ring-emerald-500/20"
                : "bg-her-surface border border-her-border/40 text-her-text hover:bg-her-surface-light"
            }`}
            title={
              isPlayingVoice
                ? "Interrupt HER"
                : userTranscript.trim()
                ? "Send spoken message now"
                : isListening
                ? "Listening... Tap to finish or pause"
                : "Tap to start listening"
            }
          >
            {isListening && (
              <span className="absolute -inset-1 rounded-full border border-emerald-500/40 animate-ping pointer-events-none opacity-40" />
            )}
            {isPlayingVoice ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
                <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
              </svg>
            ) : userTranscript.trim() ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
            ) : isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 text-rose-500">
                <path d="M10 2a3 3 0 00-3 3v4.293l4.854 4.853A3 3 0 0013 9.293V5a3 3 0 00-3-3zM4.22 3.22a.75.75 0 00-1.06 1.06l13.5 13.5a.75.75 0 101.06-1.06L4.22 3.22zM8.5 13.793l1.5 1.5V17h-2a.75.75 0 000 1.5h4a.75.75 0 000-1.5h-2v-1.707l.793-.793A4.5 4.5 0 015.5 10a.75.75 0 00-1.5 0 6 6 0 005.25 5.95v-2.157z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`h-6 w-6 ${isListening ? "text-white" : "text-her-accent"}`}>
                <path d="M10 2a3 3 0 00-3 3v5a3 3 0 006 0V5a3 3 0 00-3-3z" />
                <path d="M5.5 9.5a.75.75 0 00-1.5 0 6 6 0 005.25 5.95V17h-2a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-2v-1.55A6 6 0 0016 9.5a.75.75 0 00-1.5 0 4.5 4.5 0 01-9 0z" />
              </svg>
            )}
          </button>

          {/* Toggle Whisper text input button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowTextInput((prev) => !prev);
            }}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-her-text-muted/60 transition-all hover:bg-her-surface hover:text-her-text active:scale-95 ${
              showTextInput ? "bg-her-accent/15 text-her-accent ring-2 ring-her-accent/20" : "bg-her-surface/70 border border-her-border/30"
            }`}
            title="Type a message instead"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6.414l-2.707 2.707A1 1 0 0 1 2 16V5z" />
            </svg>
          </button>
        </div>

        {/* Dynamic Status / Helper Tip */}
        <p className="mt-3 text-[11px] text-her-text-muted/60 font-light text-center">
          {isPlayingVoice
            ? "HER is speaking · tap anywhere to interrupt"
            : userTranscript.trim()
            ? "tap the button to send now"
            : isListening
            ? "listening · speak naturally or tap to pause"
            : "tap mic to start speaking"}
        </p>
      </footer>
    </div>
  );
}
