/**
 * TypingIndicator — Breathing presence.
 * Feels like she's thinking, gathering her thoughts.
 * A quiet orb and three soft dots — intimate, not mechanical.
 */

export default function TypingIndicator() {
  return (
    <div className="animate-fade-in mb-4 flex flex-col items-start sm:mb-5">
      <span className="mb-1 ml-1 text-[9px] font-medium tracking-[0.15em] uppercase text-her-accent/50 sm:text-[10px]">
        her
      </span>
      <div className="flex items-center gap-2.5 rounded-[20px] rounded-bl-lg bg-her-ai-bubble/80 px-5 py-3.5 shadow-[0_1px_4px_rgba(180,140,110,0.06)]">
        {/* Breathing presence orb */}
        <div className="animate-presence-breathe h-[6px] w-[6px] rounded-full bg-her-accent/50" />

        {/* Soft trailing dots */}
        <div className="flex items-center gap-[4px]">
          <span
            className="h-[3.5px] w-[3.5px] rounded-full bg-her-accent/20"
            style={{ animation: "softPulse 2s ease-in-out infinite" }}
          />
          <span
            className="h-[3.5px] w-[3.5px] rounded-full bg-her-accent/20"
            style={{
              animation: "softPulse 2s ease-in-out infinite",
              animationDelay: "0.4s",
            }}
          />
          <span
            className="h-[3.5px] w-[3.5px] rounded-full bg-her-accent/20"
            style={{
              animation: "softPulse 2s ease-in-out infinite",
              animationDelay: "0.8s",
            }}
          />
        </div>
      </div>
    </div>
  );
}
