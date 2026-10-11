"use client";

import { useEffect, useRef } from "react";

export type AuraState = "idle" | "listening" | "thinking" | "speaking";

interface AudioAuraProps {
  state: AuraState;
  getAudioVolume?: () => number;
  getMicVolume?: () => number;
  className?: string;
  size?: number;
}

export default function AudioAura({
  state,
  getAudioVolume,
  getMicVolume,
  className = "",
  size = 320,
}: AudioAuraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const smoothedVolumeRef = useRef(0);

  // Store volatile callbacks & state in refs to prevent canvas resizing & jitter
  const stateRef = useRef<AuraState>(state);
  stateRef.current = state;

  const getAudioVolumeRef = useRef(getAudioVolume);
  getAudioVolumeRef.current = getAudioVolume;

  const getMicVolumeRef = useRef(getMicVolume);
  getMicVolumeRef.current = getMicVolume;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let time = 0;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // Set canvas dimension once, never in a per-frame or per-prop re-run
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const render = () => {
      time += 0.025;
      const currentState = stateRef.current;

      // Read active volume depending on current state
      let targetVolume = 0;
      if (currentState === "speaking" && getAudioVolumeRef.current) {
        targetVolume = getAudioVolumeRef.current();
      } else if (currentState === "listening" && getMicVolumeRef.current) {
        targetVolume = getMicVolumeRef.current();
      } else if (currentState === "thinking") {
        targetVolume = 0.35 + Math.sin(time * 3) * 0.15;
      }

      // Smooth volume interpolation for liquid fluidity (never jittery)
      smoothedVolumeRef.current += (targetVolume - smoothedVolumeRef.current) * 0.18;
      const vol = smoothedVolumeRef.current;

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = size * dpr * 0.28;

      ctx.clearRect(0, 0, width, height);

      // Color palettes according to state
      let primaryColor = "rgba(201, 110, 90, "; // Warm terracotta / HER crimson
      let secondaryColor = "rgba(232, 156, 131, "; // Warm peach
      let coreColor = "rgba(255, 245, 238, "; // Luminous white-warmth

      if (currentState === "thinking") {
        primaryColor = "rgba(217, 131, 78, "; // Warm amber
        secondaryColor = "rgba(244, 180, 120, ";
        coreColor = "rgba(255, 248, 235, ";
      } else if (currentState === "speaking") {
        primaryColor = "rgba(209, 90, 70, "; // Vivid crimson-coral
        secondaryColor = "rgba(247, 160, 114, ";
        coreColor = "rgba(255, 250, 245, ";
      }

      // ── Outer Diffuse Ambient Glow ──
      const outerGlowRadius = baseRadius * (1.6 + vol * 0.9 + Math.sin(time * 1.2) * 0.08);
      const outerGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.3,
        centerX,
        centerY,
        outerGlowRadius
      );
      outerGrad.addColorStop(0, primaryColor + (0.35 + vol * 0.3) + ")");
      outerGrad.addColorStop(0.5, secondaryColor + (0.15 + vol * 0.15) + ")");
      outerGrad.addColorStop(1, "rgba(201, 110, 90, 0)");

      ctx.fillStyle = outerGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, outerGlowRadius, 0, Math.PI * 2);
      ctx.fill();

      // ── Mid Organic Morphing Wave Shape ──
      const midPoints = 36;
      const midRadius = baseRadius * (1.05 + vol * 0.6);
      ctx.beginPath();

      for (let i = 0; i <= midPoints; i++) {
        const angle = (i / midPoints) * Math.PI * 2;
        // Harmonic ripples
        const wave1 = Math.sin(angle * 3 + time * 1.8) * (8 * dpr + vol * 24 * dpr);
        const wave2 = Math.cos(angle * 5 - time * 2.2) * (5 * dpr + vol * 16 * dpr);
        const r = midRadius + wave1 + wave2;

        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();

      const midGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        midRadius * 1.2
      );
      midGrad.addColorStop(0, secondaryColor + (0.6 + vol * 0.3) + ")");
      midGrad.addColorStop(0.7, primaryColor + (0.4 + vol * 0.25) + ")");
      midGrad.addColorStop(1, "rgba(201, 110, 90, 0)");

      ctx.fillStyle = midGrad;
      ctx.fill();

      // ── Core Inner Heartbeat / Pulse ──
      const innerPulse = Math.sin(time * 2.2) * 0.06;
      const coreRadius = baseRadius * (0.55 + vol * 0.35 + innerPulse);

      const coreGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        coreRadius
      );
      coreGrad.addColorStop(0, coreColor + (0.95 + vol * 0.05) + ")");
      coreGrad.addColorStop(0.4, secondaryColor + (0.8 + vol * 0.15) + ")");
      coreGrad.addColorStop(1, primaryColor + "0)");

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [size]);

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="pointer-events-none drop-shadow-[0_0_30px_rgba(201,110,90,0.18)]"
      />
    </div>
  );
}
