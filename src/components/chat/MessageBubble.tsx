import { Message } from "@/lib/types";
import { useState } from "react";

/**
 * MessageBubble — A single message in the conversation.
 * User messages: warm terracotta tint, aligned right.
 * HER messages: creamy neutral, aligned left with subtle label.
 * Feels like handwritten notes exchanged between two people.
 */

interface MessageBubbleProps {
  message: Message;
  showTimestamp?: boolean;
  index?: number;
  /** True when this message is actively being streamed */
  isStreaming?: boolean;
  /** Image action callbacks — only for messages with generated images */
  imageActions?: {
    onDownload?: (imageUrl: string) => void;
    onCopyPrompt?: () => void;
    onReusePrompt?: () => void;
    onUseAsEditSource?: (imageUrl: string) => void;
  };
  /** Dynamic thinking state label from surface copy bundle */
  thinkingLabel?: string;
}

export default function MessageBubble({ message, showTimestamp = false, index = 0, isStreaming = false, imageActions, thinkingLabel }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const hasImage = !!message.image;
  const hasText = message.content.length > 0 && message.content !== "(shared a photo)";
  const isShort = !hasImage && message.content.length <= 40;
  const isLong = !hasImage && message.content.length > 600;
  const isEmptyStreaming = isStreaming && !hasImage;
  const isThinkingState = isEmptyStreaming && message.content.length <= 40;
  const isImageLoading = !!message.imageLoading;
  const isGeneratedImage = hasImage && !isUser;
  const showActions = isGeneratedImage && !isImageLoading && imageActions;

  const [copied, setCopied] = useState(false);

  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      className={`mb-5 flex flex-col sm:mb-6 ${
        isUser ? "animate-message-in items-end" : "animate-assistant-in items-start"
      }`}
      style={{ animationDelay: `${Math.min(index * 30, 150)}ms`, animationFillMode: "backwards" }}
    >
      {/* Sender label — only for HER */}
      {!isUser && (
        <span className="mb-1.5 ml-0.5 text-[9px] font-medium tracking-[0.18em] uppercase text-her-accent/40 sm:text-[10px]">
          her
        </span>
      )}

      {/* Bubble */}
      <div
        className={`message-content rounded-[20px] sm:rounded-[22px] ${
          isImageLoading && !hasImage
            ? "max-w-[80%] overflow-hidden p-1.5 sm:max-w-[70%] sm:p-2 md:max-w-[55%]"
            : hasImage && !hasText
            ? "max-w-[75%] overflow-hidden p-1.5 sm:max-w-[65%] sm:p-2 md:max-w-[50%]"
            : hasImage && hasText
            ? "max-w-[85%] overflow-hidden p-1.5 sm:max-w-[80%] sm:p-2 md:max-w-[70%]"
            : isShort
            ? "max-w-[75%] px-[18px] py-[11px] sm:max-w-[65%] sm:px-5 sm:py-3 md:max-w-[50%]"
            : isLong
            ? "max-w-[88%] px-[18px] py-[14px] sm:max-w-[82%] sm:px-5 sm:py-4 md:max-w-[75%]"
            : "max-w-[85%] px-[18px] py-[13px] sm:max-w-[80%] sm:px-5 sm:py-[15px] md:max-w-[70%]"
        } ${
          isUser
            ? "rounded-br-md bg-her-user-bubble/75 text-her-text shadow-[0_1px_6px_rgba(180,140,110,0.06)]"
            : "rounded-bl-md bg-her-ai-bubble/80 text-her-text shadow-[0_1px_6px_rgba(180,140,110,0.05),0_0_0_0.5px_rgba(221,208,194,0.15)]"
        }`}
      >
        {/* Image loading placeholder — soft frame with presence */}
        {isImageLoading && !hasImage && (
          <div
            className="relative flex w-full items-center justify-center overflow-hidden rounded-[16px] bg-her-surface/60 sm:rounded-[18px]"
            style={{ aspectRatio: "4 / 3", maxHeight: "320px" }}
          >
            {/* Subtle shimmer overlay */}
            <div className="animate-image-shimmer absolute inset-0" />
            {/* Centered presence indicator */}
            <div className="relative z-10 flex flex-col items-center gap-3">
              <div className="animate-presence-breathe h-[7px] w-[7px] rounded-full bg-her-accent/45" />
              {hasText && (
                <span className="text-[11px] tracking-[0.04em] text-her-text-muted/30 italic">
                  {message.content}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Image — user-attached or AI-generated */}
        {hasImage && (
          <img
            src={message.image}
            alt={isGeneratedImage ? "Generated image" : "Shared photo"}
            className={`w-full object-cover ${
              isGeneratedImage
                ? "animate-image-reveal rounded-[16px] shadow-[0_2px_20px_rgba(180,140,110,0.14)] sm:rounded-[18px]"
                : "rounded-[14px] sm:rounded-[16px]"
            } ${hasText ? "mb-2.5" : ""}`}
            style={{ maxHeight: isGeneratedImage ? "400px" : "300px" }}
          />
        )}

        {/* Streaming presence — shown during thinking/placeholder states */}
        {isThinkingState && (
          <div className="flex items-center gap-3 px-0.5 py-1">
            <div className="animate-presence-breathe h-[6px] w-[6px] rounded-full bg-her-accent/45" />
            <span className="text-[12px] tracking-[0.03em] text-her-text-muted/32 italic">
              {hasText ? message.content : (thinkingLabel || "thinking…")}
            </span>
          </div>
        )}

        {/* Text */}
        {hasText && !isThinkingState && !isImageLoading && (
          <div className={`text-[13.5px] leading-[1.7] tracking-[0.005em] sm:text-[14.5px] sm:leading-[1.75] ${hasImage ? "px-3.5 pb-3 pt-1.5 sm:px-4" : ""}`}>
            {message.content.split("\n").map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
            {isStreaming && <span className="animate-stream-cursor" />}
          </div>
        )}

        {/* Image actions — download, copy prompt, reuse, edit source */}
        {showActions && (
          <div className="flex flex-wrap gap-1 px-3 pb-2.5 pt-1">
            {/* Download */}
            {imageActions.onDownload && (
              <button
                onClick={() => imageActions.onDownload!(message.image!)}
                className="rounded-full border border-her-border/12 bg-her-bg/50 px-2.5 py-1 text-[10px] text-her-text-muted/35 transition-all duration-150 hover:border-her-accent/15 hover:text-her-text-muted/55"
              >
                ↓ save
              </button>
            )}
            {/* Copy prompt */}
            {imageActions.onCopyPrompt && (
              <button
                onClick={() => {
                  imageActions.onCopyPrompt!();
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-full border border-her-border/12 bg-her-bg/50 px-2.5 py-1 text-[10px] text-her-text-muted/35 transition-all duration-150 hover:border-her-accent/15 hover:text-her-text-muted/55"
              >
                {copied ? "✓ copied" : "copy prompt"}
              </button>
            )}
            {/* Reuse prompt */}
            {imageActions.onReusePrompt && (
              <button
                onClick={() => imageActions.onReusePrompt!()}
                className="rounded-full border border-her-border/12 bg-her-bg/50 px-2.5 py-1 text-[10px] text-her-text-muted/35 transition-all duration-150 hover:border-her-accent/15 hover:text-her-text-muted/55"
              >
                reuse
              </button>
            )}
            {/* Use as edit source */}
            {imageActions.onUseAsEditSource && (
              <button
                onClick={() => imageActions.onUseAsEditSource!(message.image!)}
                className="rounded-full border border-her-border/12 bg-her-bg/50 px-2.5 py-1 text-[10px] text-her-text-muted/35 transition-all duration-150 hover:border-her-accent/15 hover:text-her-text-muted/55"
              >
                edit this
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timestamp — only show for real timestamps (not the initial greeting) */}
      {showTimestamp && message.timestamp > 0 && (
        <span className={`mt-1.5 text-[10px] tracking-wide text-her-text-muted/30 ${
          isUser ? "mr-1.5" : "ml-1.5"
        }`}>
          {time}
        </span>
      )}
    </div>
  );
}
