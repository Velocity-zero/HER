/**
 * TypingIndicator — Breathing presence.
 * Feels like she's thinking, gathering her thoughts.
 * A quiet orb and three soft dots — intimate, not mechanical.
 */

export default function TypingIndicator() {
  return (
    <div className="animate-fade-in mb-5 flex flex-col items-start sm:mb-6">
      <span className="mb-1.5 ml-0.5 text-[9px] font-medium tracking-[0.18em] uppercase text-her-accent/40 sm:text-[10px]">
        her
      </span>
      <div className="flex items-center gap-2.5 rounded-[22px] rounded-bl-md bg-her-ai-bubble/80 px-5 py-3.5 shadow-[0_1px_6px_rgba(180,140,110,0.05),0_0_0_0.5px_rgba(221,208,194,0.15)]">
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
