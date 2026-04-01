"use client";

import { useEffect, useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react";

/**
 * ChatInput — Premium warm conversational composer.
 * Pill-shaped, luxurious feel. Like whispering into warm space.
 * Supports Enter to send (desktop), Shift+Enter for newline.
 * Supports single image attachment with preview.
 */

/** Max image size: 4 MB — keeps localStorage and data URLs reasonable */
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Max textarea height before internal scroll kicks in */
const MAX_HEIGHT = 140;

interface ChatInputProps {
  onSend: (message: string, image?: string) => void;
  disabled?: boolean;
  /** Externally set prefill text (e.g. from suggestion chips) */
  prefillText?: string;
  /** Called after prefill is consumed */
  onPrefillConsumed?: () => void;
  /** Toggle the Image Studio panel */
  onToggleStudio?: () => void;
  /** Whether the Image Studio is currently open */
  studioOpen?: boolean;
}

/**
 * Detect touch-primary devices (phones/tablets with virtual keyboards).
 * Uses coarse pointer detection — reliable, no user-agent sniffing.
 */
function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
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

export default function ChatInput({ onSend, disabled = false, prefillText, onPrefillConsumed, onToggleStudio, studioOpen }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when HER finishes replying — desktop only.
  useEffect(() => {
    if (!disabled && !isTouchDevice()) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  // Auto-dismiss image error after 3 seconds
  useEffect(() => {
    if (!imageError) return;
    const timer = setTimeout(() => setImageError(null), 3000);
    return () => clearTimeout(timer);
  }, [imageError]);

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

  // Consume prefilled text from suggestion chips
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

        {/* Image preview — appears above the input row */}
        {image && (
          <div className="animate-fade-in mb-2.5 flex items-start gap-2">
            <div className="relative">
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
          <div className="animate-fade-in mb-2">
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

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
            tabIndex={-1}
          />

          {/* Textarea — pill-shaped, warm */}
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

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className={`mb-0.5 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-her-accent/20 focus-visible:ring-offset-2 focus-visible:ring-offset-her-bg sm:h-[44px] sm:w-[44px] ${
              canSend
                ? "bg-her-accent text-white shadow-[0_2px_10px_rgba(201,110,90,0.18)] hover:bg-her-accent-hover hover:shadow-[0_3px_16px_rgba(201,110,90,0.24)] active:scale-[0.93] active:shadow-[0_1px_4px_rgba(201,110,90,0.12)]"
                : disabled
                ? "bg-her-surface/40 text-her-text-muted/12 cursor-not-allowed"
                : "bg-her-surface/40 text-her-text-muted/18 cursor-default"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-[17px] w-[17px] transition-all duration-300 sm:h-[18px] sm:w-[18px] ${
                canSend ? "-translate-x-[0.5px] translate-y-[0.5px]" : "opacity-50"
              }`}
            >
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
