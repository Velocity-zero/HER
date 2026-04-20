// One-shot notification system smoke test
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(url, key);

async function main() {
  console.log("\n━━━ HER Notification System Smoke Test ━━━\n");

  // 1. VAPID keys
  console.log("1. VAPID configuration");
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const priv = process.env.VAPID_PRIVATE_KEY || "";
  console.log(`   public key:  ${pub ? `✓ ${pub.length} chars` : "✗ MISSING"}`);
  console.log(`   private key: ${priv ? `✓ ${priv.length} chars` : "✗ MISSING"}`);
  console.log(`   subject:     ${process.env.VAPID_SUBJECT || "(default)"}`);

  // 2. web-push library
  console.log("\n2. web-push library");
  let webPush;
  try {
    webPush = (await import("web-push")).default;
    webPush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:test@example.com", pub, priv);
    console.log("   ✓ web-push loaded & VAPID accepted");
  } catch (e) {
    console.log(`   ✗ ${e.message}`);
  }

  // 3. Tables
  console.log("\n3. Database tables");
  for (const t of ["scheduled_events", "notification_settings", "interaction_patterns", "messages"]) {
    const { error, count } = await sb.from(t).select("*", { count: "exact", head: true });
    console.log(`   ${error ? "✗" : "✓"} ${t.padEnd(25)} ${error ? error.message : `${count} rows`}`);
  }

  // 4. Push subscriptions
  console.log("\n4. Active push subscriptions");
  const { data: subs, error: subErr } = await sb
    .from("notification_settings")
    .select("user_id, notifications_enabled, push_subscription, quiet_hours_start, quiet_hours_end, timezone");
  if (subErr) {
    console.log(`   ✗ ${subErr.message}`);
  } else {
    const withPush = (subs || []).filter((s) => s.push_subscription);
    console.log(`   total settings rows: ${subs?.length || 0}`);
    console.log(`   with push_subscription: ${withPush.length}`);
    withPush.forEach((s, i) => {
      const ep = s.push_subscription?.endpoint || "";
      const provider = ep.includes("fcm") ? "FCM/Chrome" : ep.includes("mozilla") ? "Mozilla" : ep.includes("apple") ? "Apple" : "?";
      console.log(`     [${i + 1}] user=${s.user_id.slice(0, 8)}… ${provider} enabled=${s.notifications_enabled} quiet=${s.quiet_hours_start}-${s.quiet_hours_end}`);
    });
  }

  // 5. Pending scheduled events
  console.log("\n5. Scheduled events");
  const { data: events } = await sb
    .from("scheduled_events")
    .select("id, user_id, type, scheduled_for, sent_at")
    .order("scheduled_for", { ascending: false })
    .limit(10);
  console.log(`   recent: ${events?.length || 0}`);
  const pending = (events || []).filter((e) => !e.sent_at && new Date(e.scheduled_for) <= new Date());
  console.log(`   due now: ${pending.length}`);

  // 6. Try a real push to first subscription
  if (webPush && subs) {
    const firstWithPush = subs.find((s) => s.push_subscription && s.notifications_enabled);
    if (firstWithPush) {
      console.log(`\n6. Attempting REAL push to user ${firstWithPush.user_id.slice(0, 8)}…`);
      try {
        await webPush.sendNotification(
          firstWithPush.push_subscription,
          JSON.stringify({ title: "HER", body: "smoke test ping 🔔", data: { url: "/chat" } }),
          { TTL: 60 }
        );
        console.log("   ✓ Push delivered to provider (check device)");
      } catch (e) {
        console.log(`   ✗ statusCode=${e.statusCode} body=${e.body || e.message}`);
      }
    } else {
      console.log("\n6. No active push subscription — skipping live push test");
      console.log("   → Sign in on a device, open chat, click bell, click 'enable push notifications'");
    }
  }

  console.log("\n━━━ Done ━━━\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
