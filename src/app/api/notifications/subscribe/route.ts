/**
 * POST /api/notifications/subscribe
 *
 * Saves a Web Push subscription for the authenticated user.
 * Called by the client after the user grants notification permission.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/api-auth";
import { savePushSubscription } from "@/lib/notification-settings";

export async function POST(req: NextRequest) {
  const auth = await validateApiRequest(req);
  if (auth.error) return auth.error;

  try {
    const subscription = await req.json();

    if (!subscription?.endpoint) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const ok = await savePushSubscription(auth.userId, subscription);

    if (!ok) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
