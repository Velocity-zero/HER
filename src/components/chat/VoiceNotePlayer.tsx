"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface VoiceNotePlayerProps {
  audioUrl: string;
  duration?: number;
  transcript?: string;
  isAssistant?: boolean;
  timestamp?: number;
  voiceEmotion?: string;
}

// Deterministic mock waveform bar heights for natural voice visualization
function generateWaveformHeights(seedStr: string, count: number = 32): number[] {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const heights: number[] = [];
  for (let i = 0; i < count; i++) {
    const pseudo = Math.abs(Math.sin((hash + i * 17) * 0.45));
    // Normal human speech distribution (bell curve with rhythmic peaks)
    const normalized = 0.2 + pseudo * 0.75;
    heights.push(Math.max(0.18, Math.min(1.0, normalized)));
  }
  return heights;
}

export default function VoiceNotePlayer({
  audioUrl,
  duration = 0,
  transcript,
  isAssistant = true,
  voiceEmotion,
}: VoiceNotePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const [showTranscript, setShowTranscript] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);

  // Generate waveform pattern keyed by audio URL or transcript
  const waveformHeights = useRef<number[]>([]);
  if (waveformHeights.current.length === 0) {
    waveformHeights.current = generateWaveformHeights(audioUrl || transcript || "voice", 30);
  }

  // Format seconds to mm:ss
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Initialize and bind audio element
  useEffect(() => {
    if (!audioUrl) return;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      setIsPlaying(false);
      setIsLoading(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audioRef.current = null;
    };
  }, [audioUrl]);

  // Toggle play/pause
  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        setIsLoading(true);
        audio.playbackRate = playbackRate;
        await audio.play();
        setIsPlaying(true);
      } catch (err) {
        console.warn("[VoiceNotePlayer] Playback error:", err);
      } finally {
        setIsLoading(false);
      }
    }
  }, [isPlaying, playbackRate]);

  // Cycle speed: 1x -> 1.5x -> 2x -> 1x
  const cyclePlaybackRate = useCallback(() => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  }, [playbackRate]);

  // Handle clicking on waveform to seek
  const handleWaveformClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = waveformRef.current;
      const audio = audioRef.current;
      if (!el || !audio || audioDuration <= 0) return;

      const rect = el.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      const targetTime = percentage * audioDuration;

      audio.currentTime = targetTime;
      setCurrentTime(targetTime);
    },
    [audioDuration]
  );

  const progressPercent = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0;

  return (
    <div
      className={`relative my-1.5 flex flex-col rounded-2xl border transition-all duration-300 ${
        isAssistant
          ? "border-her-border/30 bg-gradient-to-br from-her-surface/90 via-her-surface/60 to-her-surface-light/40 shadow-[0_2px_12px_rgba(180,140,110,0.06)]"
          : "border-her-accent/25 bg-gradient-to-br from-her-accent/[0.08] via-her-surface/70 to-her-accent/[0.04] shadow-[0_2px_10px_rgba(201,110,90,0.08)]"
      } p-3 sm:p-3.5 max-w-sm`}
    >
      {/* Top Row: Play button + Waveform + Duration */}
      <div className="flex items-center gap-3">
        {/* Circular WhatsApp Play/Pause Button */}
        <button
          type="button"
          onClick={togglePlay}
          disabled={isLoading}
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:scale-95 shadow-sm ${
            isAssistant
              ? "bg-her-accent text-white shadow-her-accent/25 hover:bg-her-accent-hover"
              : "bg-her-text text-white shadow-her-text/20 hover:bg-her-text/90"
          }`}
          aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying && (
            <span className="absolute -inset-1 rounded-full border border-her-accent/40 animate-ping pointer-events-none opacity-40" />
          )}

          {isLoading ? (
            <svg
              className="h-4 w-4 animate-spin text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          ) : isPlaying ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <rect x="6" y="5" width="4" height="14" rx="1.5" />
              <rect x="14" y="5" width="4" height="14" rx="1.5" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4 translate-x-0.5"
            >
              <path d="M8 5.14v13.72a1 1 0 001.55.83l11-6.86a1 1 0 000-1.66l-11-6.86A1 1 0 008 5.14z" />
            </svg>
          )}
        </button>

        {/* Center: Interactive Scrubber Waveform */}
        <div className="flex flex-1 flex-col gap-1.5 min-w-0">
          <div
            ref={waveformRef}
            onClick={handleWaveformClick}
            className="flex items-center gap-[3px] h-7 cursor-pointer group py-1"
            title="Click to seek"
          >
            {waveformHeights.current.map((scale, idx) => {
              const barPercent = (idx / waveformHeights.current.length) * 100;
              const isPassed = barPercent <= progressPercent;

              return (
                <div
                  key={idx}
                  className="relative flex-1 h-full flex items-center justify-center pointer-events-none"
                >
                  <span
                    className={`w-full max-w-[3px] rounded-full transition-all duration-150 ${
                      isPassed
                        ? isAssistant
                          ? "bg-her-accent"
                          : "bg-her-text"
                        : "bg-her-border/70 group-hover:bg-her-border"
                    }`}
                    style={{
                      height: `${Math.max(4, scale * 24)}px`,
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Time elapsed + Speed toggle */}
          <div className="flex items-center justify-between text-[11px] font-medium text-her-text-muted/70 tracking-wide">
            <span>
              {isPlaying || currentTime > 0
                ? `${formatTime(currentTime)} / ${formatTime(audioDuration || duration)}`
                : formatTime(audioDuration || duration)}
            </span>

            <div className="flex items-center gap-2">
              {/* Playback speed toggle */}
              <button
                type="button"
                onClick={cyclePlaybackRate}
                className="rounded-full bg-her-surface px-1.5 py-0.5 text-[10px] font-semibold text-her-text-muted/80 hover:bg-her-surface-light hover:text-her-text transition-colors border border-her-border/30"
                title="Change speed"
              >
                {playbackRate}x
              </button>

              {/* Mic Icon indicator */}
              <span className="flex items-center text-her-accent" title="Voice note">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3 w-3"
                >
                  <path d="M8 2a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V4a2 2 0 0 0-2-2Z" />
                  <path d="M4.5 7.5a.75.75 0 0 0-1.5 0 5 5 0 0 0 4.25 4.945v1.305h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.305A5 5 0 0 0 13 7.5a.75.75 0 0 0-1.5 0 3.5 3.5 0 0 1-7 0Z" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Optional: Voice emotion pill badge */}
      {voiceEmotion && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-her-text-muted/65 italic">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-her-accent/50" />
          <span>vocal nuance: {voiceEmotion}</span>
        </div>
      )}

      {/* Transcript collapsible preview */}
      {transcript && transcript.trim() && (
        <div className="mt-2 pt-2 border-t border-her-border/20">
          <button
            type="button"
            onClick={() => setShowTranscript((prev) => !prev)}
            className="flex items-center gap-1 text-[10px] tracking-wider uppercase font-semibold text-her-accent/80 hover:text-her-accent transition-colors"
          >
            <span>{showTranscript ? "Hide transcript" : "Show transcript"}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`h-2.5 w-2.5 transition-transform duration-200 ${
                showTranscript ? "rotate-180" : ""
              }`}
            >
              <path
                fillRule="evenodd"
                d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {showTranscript && (
            <p className="mt-1.5 text-xs text-her-text/80 leading-relaxed italic animate-in fade-in">
              “{transcript}”
            </p>
          )}
        </div>
      )}
    </div>
  );
}
