"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/utils";
import { detectUserTimezone } from "@/lib/notification-settings";

/**
 * NotificationSettings — Minimal settings panel for HER's notification system.
 * Slides in as a small popover. Keeps the aesthetic minimal and warm.
 */

interface NotificationSettingsProps {
  open: boolean;
  onClose: () => void;
  accessToken: string | null;
}

interface Settings {
  notifications_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
}

export default function NotificationSettings({
  open,
  onClose,
  accessToken,
}: NotificationSettingsProps) {
  const [settings, setSettings] = useState<Settings>({
    notifications_enabled: true,
    quiet_hours_start: "01:00",
    quiet_hours_end: "05:00",
    timezone: "UTC",
  });
  const [pushEnabled, setPushEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load settings
  /* eslint-disable react-hooks/set-state-in-effect -- fetches server settings + reads Notification.permission on modal open; both are external sources, not derivable. */
  useEffect(() => {
    if (!open) return;
    authFetch("/api/notifications/settings", {}, accessToken)
      .then((res) => res.json())
      .then((data) => {
        if (data.notifications_enabled !== undefined) {
          setSettings(data);
        }
      })
      .catch(() => {});

    // Check push permission
    if ("Notification" in window) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, [open, accessToken]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = useCallback(
    async (updates: Partial<Settings>) => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);
      setSaving(true);
      try {
        await authFetch(
          "/api/notifications/settings",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          },
          accessToken
        );
      } catch {
        // Silent fail
      }
      setSaving(false);
    },
    [settings, accessToken]
  );

  const enablePush = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    setPushEnabled(true);

    // Get push subscription from service worker
    const registration = await navigator.serviceWorker.ready;
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    if (!vapidKey) return;

    try {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });

      // Send subscription to server
      await authFetch(
        "/api/notifications/subscribe",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        },
        accessToken
      );
    } catch (err) {
      console.warn("[HER] Push subscription failed:", err);
    }

    // Also save timezone while we're at it
    const tz = detectUserTimezone();
    if (tz !== settings.timezone) {
      save({ timezone: tz });
    }
  }, [accessToken, settings.timezone, save]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div
        className="mx-4 w-full max-w-sm rounded-2xl bg-her-bg/95 p-6 shadow-xl backdrop-blur-lg border border-her-text-muted/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[13px] font-light tracking-[0.15em] text-her-text-muted/70">
            notifications
          </h2>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-her-text-muted/40 hover:text-her-text-muted/70 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Main toggle */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-[12px] text-her-text-muted/60">
            enable notifications
          </span>
          <button
            onClick={() => save({ notifications_enabled: !settings.notifications_enabled })}
            role="switch"
            aria-checked={settings.notifications_enabled}
            aria-label="Toggle notifications"
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 ${settings.notifications_enabled ? "bg-her-accent/60" : "bg-her-text-muted/20"}`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300 ease-out ${settings.notifications_enabled ? "translate-x-[1.375rem]" : "translate-x-0.5"}`}
            />
          </button>
        </div>

        {settings.notifications_enabled && (
          <>
            {/* Push notifications */}
            {!pushEnabled && "Notification" in (typeof window !== "undefined" ? window : {}) && (
              <button
                onClick={enablePush}
                className="mb-4 w-full rounded-xl bg-her-accent/10 py-2.5 text-[11px] tracking-[0.08em] text-her-accent/80 hover:bg-her-accent/15 transition-colors"
              >
                enable push notifications
              </button>
            )}

            {pushEnabled && (
              <div className="mb-4 text-[11px] text-her-accent/50 tracking-[0.05em]">
                ✓ push notifications active
              </div>
            )}

            {/* Quiet hours */}
            <div className="mb-3">
              <span className="text-[11px] text-her-text-muted/50 tracking-[0.05em]">
                quiet hours
              </span>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="time"
                  value={settings.quiet_hours_start}
                  onChange={(e) => save({ quiet_hours_start: e.target.value })}
                  className="rounded-lg bg-her-text-muted/5 px-2.5 py-1.5 text-[12px] text-her-text-muted/70 border border-her-text-muted/10 outline-none focus:border-her-accent/30"
                />
                <span className="text-[11px] text-her-text-muted/30">to</span>
                <input
                  type="time"
                  value={settings.quiet_hours_end}
                  onChange={(e) => save({ quiet_hours_end: e.target.value })}
                  className="rounded-lg bg-her-text-muted/5 px-2.5 py-1.5 text-[12px] text-her-text-muted/70 border border-her-text-muted/10 outline-none focus:border-her-accent/30"
                />
              </div>
            </div>

            {/* Timezone */}
            <div className="text-[10px] text-her-text-muted/30 tracking-[0.05em]">
              timezone: {settings.timezone}
            </div>
          </>
        )}

        {/* Saving indicator */}
        {saving && (
          <div className="mt-3 text-[10px] text-her-accent/40 animate-pulse">
            saving...
          </div>
        )}
      </div>
    </div>
  );
}
