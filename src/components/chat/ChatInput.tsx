"use client";

import { useEffect, useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react";
import type { ReplyRef } from "@/lib/types";
import { isTouchDevice } from "@/lib/utils";

/**
 * ChatInput — Premium warm conversational composer.
 * Pill-shaped, luxurious feel. Like whispering into warm space.
 * Supports Enter to send (desktop), Shift+Enter for newline.
 * Supports single image attachment with preview.
 * Supports replying to messages with a quote preview bar.
 */

/** Max image size: 4 MB — keeps localStorage and data URLs reasonable */
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Max textarea height before internal scroll kicks in */
const MAX_HEIGHT = 140;

export interface VoiceNoteMeta {
  audioUrl: string;
  audioDuration: number;
  isVoiceNote: boolean;
  voiceEmotion?: string;
}

interface ChatInputProps {
  onSend: (message: string, image?: string, voiceNoteMeta?: VoiceNoteMeta) => void;
  disabled?: boolean;
  /** Externally set prefill text (e.g. from suggestion chips) */
  prefillText?: string;
  /** Called after prefill is consumed */
  onPrefillConsumed?: () => void;
  /** Toggle the Image Studio panel */
  onToggleStudio?: () => void;
  /** Whether the Image Studio is currently open */
  studioOpen?: boolean;
  /** Toggle the Earbud hands-free mode */
  onToggleEarbud?: () => void;
  /** Whether the Earbud mode is currently active */
  earbudActive?: boolean;
  /** The message being replied to (shows quote bar above input) */
  replyingTo?: ReplyRef | null;
  /** Called to dismiss the reply quote */
  onCancelReply?: () => void;
}

/** Read a File as a base64 data URL. */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function ChatInput({
  onSend,
  disabled = false,
  prefillText,
  onPrefillConsumed,
  onToggleStudio,
  studioOpen,
  onToggleEarbud,
  earbudActive,
  replyingTo,
  onCancelReply,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── WhatsApp-style voice note recording state ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const levelIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recognitionRef = useRef<any>(null);
  const voiceTranscriptRef = useRef("");

  // Auto-focus when HER finishes replying — desktop only.
  useEffect(() => {
    if (!disabled && !isTouchDevice() && !isRecording) {
      textareaRef.current?.focus();
    }
  }, [disabled, isRecording]);

  // Auto-dismiss image error after 3 seconds
  useEffect(() => {
    if (!imageError) return;
    const timer = setTimeout(() => setImageError(null), 3000);
    return () => clearTimeout(timer);
  }, [imageError]);

  // Clean up recording on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const cleanupRecordingTracks = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
    timerRef.current = null;
    levelIntervalRef.current = null;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordingLevel(0);
  }, []);

  const cancelRecordingVoiceNote = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    audioChunksRef.current = [];
    cleanupRecordingTracks();
  }, [cleanupRecordingTracks]);

  const sendRecordingVoiceNote = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") {
      cancelRecordingVoiceNote();
      return;
    }

    const duration = Math.max(1, recordingSeconds);
    const capturedTranscript = voiceTranscriptRef.current;

    mr.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        onSend(capturedTranscript || "🎙️ Voice message", undefined, {
          audioUrl: dataUrl,
          audioDuration: duration,
          isVoiceNote: true,
        });
      };
      reader.readAsDataURL(blob);
      cleanupRecordingTracks();
    };

    mr.stop();
  }, [recordingSeconds, onSend, cleanupRecordingTracks, cancelRecordingVoiceNote]);

  const startRecordingVoiceNote = useCallback(async () => {
    if (disabled || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        audioContextRef.current = ctx;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        levelIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          setRecordingLevel(Math.min(1, avg / 90));
        }, 80);
      } catch {}

      voiceTranscriptRef.current = "";
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.onresult = (ev: any) => {
            let str = "";
            for (let i = 0; i < ev.results.length; i++) {
              if (ev.results[i][0]) str += ev.results[i][0].transcript + " ";
            }
            voiceTranscriptRef.current = str.trim();
          };
          rec.start();
          recognitionRef.current = rec;
        } catch {}
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "audio/webm";

      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mr.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn("[VoiceNote] Mic error:", err);
      setImageError("microphone access needed to record voice note");
    }
  }, [disabled, isRecording]);

  // ── Smooth auto-resize ──
  const recalcHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Temporarily collapse to measure natural scroll height
    el.style.height = "0px";
    const natural = el.scrollHeight;
    const clamped = Math.min(natural, MAX_HEIGHT);
    el.style.height = clamped + "px";
    // Enable internal scroll only when content exceeds max
    el.style.overflowY = natural > MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  // Consume prefilled text from suggestion chips.
  /* eslint-disable react-hooks/set-state-in-effect -- prop→state mirror is required: the value becomes editable once consumed, so we can't derive it. */
  useEffect(() => {
    if (prefillText) {
      setValue(prefillText);
      onPrefillConsumed?.();
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        recalcHeight();
      });
    }
  }, [prefillText, onPrefillConsumed, recalcHeight]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && !image) || disabled) return;

    onSend(trimmed, image ?? undefined);
    setValue("");
    setImage(null);

    // Reset height smoothly
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
      if (!isTouchDevice()) {
        textareaRef.current.focus();
      }
    }
  }, [value, image, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop: Enter sends, Shift+Enter newline
    // Mobile: let the keyboard handle Enter naturally (avoids accidental sends with autocomplete)
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice()) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageError("only photos please — jpg, png, or webp");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setImageError("that photo is too large — under 4 MB works best");
      return;
    }

    try {
      const dataUrl = await readFileAsDataURL(file);
      setImage(dataUrl);
      setImageError(null);
    } catch {
      setImageError("couldn't read that photo — try another?");
    }
  }, []);

  const removeImage = useCallback(() => {
    setImage(null);
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const canSend = (value.trim().length > 0 || !!image) && !disabled;

  return (
    <div className="shrink-0 bg-gradient-to-t from-her-bg via-her-bg to-her-bg/80 pb-3 pt-2.5 sm:pb-5 sm:pt-3">
      <div className="mx-auto max-w-[640px] px-3 pb-[env(safe-area-inset-bottom)] sm:px-5 md:px-6">

        {/* Reply quote bar — appears when replying to a message */}
        {replyingTo && (
          <div className="animate-fade-in mb-2 flex items-center gap-2 rounded-[14px] border border-her-border/15 bg-her-surface/40 px-3 py-2 shadow-[0_1px_3px_rgba(180,140,110,0.04)]">
            <div className={`h-full w-[2.5px] shrink-0 self-stretch rounded-full ${
              replyingTo.role === "user" ? "bg-her-accent/40" : "bg-her-text-muted/25"
            }`} />
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-medium tracking-[0.06em] text-her-text-muted/45">
                replying to {replyingTo.role === "user" ? "yourself" : "her"}
              </span>
              <span className="block truncate text-[11px] leading-[1.45] text-her-text-muted/55 sm:text-[12px]">
                {replyingTo.content.length > 80 ? replyingTo.content.slice(0, 80).trimEnd() + "…" : replyingTo.content}
              </span>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancel reply"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-her-text-muted/30 transition-colors duration-200 hover:bg-her-text/[0.06] hover:text-her-text-muted/50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z" />
              </svg>
            </button>
          </div>
        )}

        {/* Image preview — appears above the input row */}
        {image && (
          <div className="animate-fade-in mb-2.5 flex items-start gap-2">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URL, no remote optimization possible */}
              <img
                src={image}
                alt="Selected photo"
                className="h-[72px] w-[72px] rounded-[16px] border border-her-border/15 object-cover shadow-[0_2px_8px_rgba(180,140,110,0.08)] sm:h-[84px] sm:w-[84px] sm:rounded-[18px]"
              />
              <button
                type="button"
                onClick={removeImage}
                aria-label="Remove photo"
                className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-her-text/60 text-white shadow-sm transition-all duration-200 hover:bg-her-text/80 active:scale-[0.90] sm:h-5 sm:w-5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-2.5 w-2.5 sm:h-3 sm:w-3">
                  <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Image error toast */}
        {imageError && (
          <div className="animate-fade-in mb-2" role="alert" aria-live="assertive">
            <p className="text-[11px] font-light text-her-accent/70 sm:text-[12px]">{imageError}</p>
          </div>
        )}

        {/* Input row: attachment + textarea + send */}
        <div className="flex items-end gap-1.5 sm:gap-2">
          {/* Attachment button */}
          <button
            type="button"
            onClick={openFilePicker}
            disabled={disabled}
            aria-label="Attach photo"
            className="mb-0.5 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-her-text-muted/28 transition-all duration-300 hover:bg-her-surface/60 hover:text-her-text-muted/50 active:scale-[0.92] disabled:opacity-25 disabled:cursor-not-allowed sm:h-[44px] sm:w-[44px]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-[17px] w-[17px] sm:h-[18px] sm:w-[18px]">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
          </button>

          {/* Image Studio toggle */}
          {onToggleStudio && (
            <button
              type="button"
              onClick={onToggleStudio}
              disabled={disabled}
              aria-label={studioOpen ? "Close image studio" : "Open image studio"}
              className={`mb-0.5 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full transition-all duration-300 active:scale-[0.92] disabled:opacity-25 disabled:cursor-not-allowed sm:h-[44px] sm:w-[44px] ${
                studioOpen
                  ? "bg-her-accent/[0.08] text-her-accent/50 hover:bg-her-accent/[0.12]"
                  : "text-her-text-muted/28 hover:bg-her-surface/60 hover:text-her-text-muted/50"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-[16px] w-[16px] sm:h-[17px] sm:w-[17px]">
                <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909-4.22-4.22a.75.75 0 00-1.06 0L2.5 11.06zm6.5-3.81a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          {/* Phone Call Mode toggle */}
          {onToggleEarbud && (
            <button
              type="button"
              onClick={onToggleEarbud}
              disabled={disabled}
              aria-label={earbudActive ? "End call" : "Call Samantha"}
              title="Call Samantha (Phone Call)"
              className={`mb-0.5 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full transition-all duration-300 active:scale-[0.92] disabled:opacity-25 disabled:cursor-not-allowed sm:h-[44px] sm:w-[44px] ${
                earbudActive
                  ? "bg-her-accent/[0.12] text-her-accent hover:bg-her-accent/[0.18]"
                  : "text-her-text-muted/28 hover:bg-her-surface/60 hover:text-her-text-muted/50"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-[16px] w-[16px] sm:h-[17px] sm:w-[17px]"
              >
                <path fillRule="evenodd" d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
            tabIndex={-1}
          />

          {/* Textarea or WhatsApp Recording Bar */}
          {isRecording ? (
            <div className="flex-1 flex items-center justify-between min-h-[44px] sm:min-h-[48px] rounded-[22px] sm:rounded-[24px] border border-rose-400/50 bg-rose-50/80 dark:bg-rose-950/20 px-4 py-2 shadow-sm animate-in fade-in">
              {/* Red dot & duration */}
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-600" />
                </span>
                <span className="text-xs font-mono font-semibold tracking-wider text-rose-700 dark:text-rose-400">
                  {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                </span>
              </div>

              {/* Reactive voice waveform */}
              <div className="flex items-center gap-[3px] h-4 mx-2">
                {[0.4, 0.8, 1.2, 0.6, 1.1, 0.7, 0.5, 0.9, 0.7, 0.4].map((scale, i) => (
                  <span
                    key={i}
                    className="w-[2px] rounded-full bg-rose-500 transition-all duration-75"
                    style={{
                      height: `${Math.max(4, (recordingLevel * 20 * scale) + 2)}px`,
                    }}
                  />
                ))}
              </div>

              {/* Discard trash button */}
              <button
                type="button"
                onClick={cancelRecordingVoiceNote}
                className="flex h-7 w-7 items-center justify-center rounded-full text-rose-600 hover:bg-rose-100 transition-colors active:scale-95"
                title="Discard recording"
                aria-label="Discard recording"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.67.028 2.488.083.01-.11.012-.22.012-.333a1.25 1.25 0 00-1.25-1.25h-2.5a1.25 1.25 0 00-1.25 1.25c0 .113.003.224.012.333.818-.055 1.647-.083 2.488-.083zm-2 5a.75.75 0 01.75.75v5.5a.75.75 0 01-1.5 0v-5.5A.75.75 0 018 9zm4 0a.75.75 0 01.75.75v5.5a.75.75 0 01-1.5 0v-5.5A.75.75 0 0112 9z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  // Recalc on next frame so the value is committed
                  requestAnimationFrame(recalcHeight);
                }}
                onKeyDown={handleKeyDown}
                placeholder="talk to me…"
                disabled={disabled}
                rows={1}
                className="composer-textarea focus-warm min-h-[44px] w-full resize-none overflow-hidden rounded-[22px] border border-her-border/35 bg-her-composer px-4 py-3 text-[14px] leading-[1.6] text-her-text shadow-[0_1px_3px_rgba(180,140,110,0.05),inset_0_1px_2px_rgba(180,140,110,0.03)] transition-[border-color,box-shadow] duration-300 ease-out disabled:opacity-25 disabled:cursor-not-allowed sm:min-h-[48px] sm:rounded-[24px] sm:px-5 sm:py-[13px] sm:text-[14.5px] sm:leading-[1.65]"
              />
            </div>
          )}

          {/* Action button: Send arrow if text/image, or Send voice note if recording, or Mic button if empty! */}
          {isRecording ? (
            <button
              type="button"
              onClick={sendRecordingVoiceNote}
              aria-label="Send voice note"
              className="mb-0.5 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-rose-600 text-white shadow-[0_2px_10px_rgba(225,29,72,0.25)] hover:bg-rose-700 active:scale-[0.93] transition-all sm:h-[44px] sm:w-[44px]"
              title="Send voice note"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 translate-x-0.5">
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          ) : canSend ? (
            <button
              type="button"
              onClick={handleSend}
              aria-label="Send message"
              className="mb-0.5 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-her-accent text-white shadow-[0_2px_10px_rgba(201,110,90,0.18)] hover:bg-her-accent-hover hover:shadow-[0_3px_16px_rgba(201,110,90,0.24)] active:scale-[0.93] active:shadow-[0_1px_4px_rgba(201,110,90,0.12)] transition-all sm:h-[44px] sm:w-[44px]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-[17px] w-[17px] -translate-x-[0.5px] translate-y-[0.5px] transition-all sm:h-[18px] sm:w-[18px]"
              >
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecordingVoiceNote}
              disabled={disabled}
              aria-label="Record voice note"
              title="Record voice note (WhatsApp style)"
              className="mb-0.5 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-her-surface/60 text-her-accent/80 hover:bg-her-accent/15 hover:text-her-accent active:scale-[0.92] transition-all disabled:opacity-30 disabled:cursor-not-allowed sm:h-[44px] sm:w-[44px] border border-her-border/30 shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 sm:h-[18px] sm:w-[18px]">
                <path d="M10 2a3 3 0 00-3 3v5a3 3 0 006 0V5a3 3 0 00-3-3z" />
                <path d="M5.5 9.5a.75.75 0 00-1.5 0 6 6 0 005.25 5.95V17h-2a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-2v-1.55A6 6 0 0016 9.5a.75.75 0 00-1.5 0 4.5 4.5 0 01-9 0z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
