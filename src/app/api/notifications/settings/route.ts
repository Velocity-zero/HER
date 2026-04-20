/**
 * GET/POST /api/notifications/settings
 *
 * GET:  Fetch current notification settings
 * POST: Update notification settings (partial update)
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/api-auth";
import {
  getNotificationSettings,
  saveNotificationSettings,
} from "@/lib/notification-settings";

export async function GET(req: NextRequest) {
  const auth = await validateApiRequest(req);
  if (auth.error) return auth.error;

  const settings = await getNotificationSettings(auth.userId);
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const auth = await validateApiRequest(req);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();

    // Whitelist allowed fields
    const updates: Record<string, unknown> = {};
    if (typeof body.notifications_enabled === "boolean") {
      updates.notifications_enabled = body.notifications_enabled;
    }
    if (typeof body.quiet_hours_start === "string") {
      updates.quiet_hours_start = body.quiet_hours_start;
    }
    if (typeof body.quiet_hours_end === "string") {
      updates.quiet_hours_end = body.quiet_hours_end;
    }
    if (typeof body.timezone === "string") {
      updates.timezone = body.timezone;
    }
    if (body.push_subscription !== undefined) {
      updates.push_subscription = body.push_subscription;
    }

    const ok = await saveNotificationSettings(auth.userId, updates);

    if (!ok) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
