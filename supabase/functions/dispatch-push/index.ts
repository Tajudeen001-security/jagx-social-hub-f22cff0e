// Receives a webhook from the on_notification_insert trigger and fans out
// FCM v1 push messages to every push_token belonging to the target user.
// No client JWT — protected by x-dispatch-secret header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED       = Deno.env.get("DISPATCH_PUSH_SECRET") ?? "";

const TYPE_TITLE: Record<string, string> = {
  message: "New message",
  new_post: "New post",
  like: "New like",
  comment: "New comment",
  follow: "New follower",
  coin_tip: "JagX received",
  order_status: "Order update",
  general: "JagX Connect",
  story_view: "Story viewed",
  unlock: "Content unlocked",
};
const TYPE_URL: Record<string, (n: any) => string> = {
  message: (n) => (n.from_user_id ? `/dm/${n.from_user_id}` : "/chat"),
  new_post: (n) => (n.related_post_id ? `/post/${n.related_post_id}` : "/"),
  like: (n) => (n.related_post_id ? `/post/${n.related_post_id}` : "/notifications"),
  comment: (n) => (n.related_post_id ? `/post/${n.related_post_id}` : "/notifications"),
  follow: (n) => (n.from_user_id ? `/user/${n.from_user_id}` : "/notifications"),
  coin_tip: () => "/coins",
  order_status: () => "/marketplace/orders",
  general: () => "/notifications",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (SHARED && req.headers.get("x-dispatch-secret") !== SHARED) {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    const n = await req.json();
    if (!n?.user_id) return json({ ok: true, skipped: "no user" });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: tokRows } = await admin
      .from("push_tokens").select("token").eq("user_id", n.user_id);
    const tokens = (tokRows ?? []).map((r: any) => r.token).filter(Boolean);
    if (tokens.length === 0) return json({ ok: true, sent: 0 });

    const sa = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "{}");
    if (!sa.project_id) return json({ ok: true, sent: 0, note: "no service account" });
    sa.private_key = String(sa.private_key).replace(/\\n/g, "\n");
    const accessToken = await getAccessToken(sa);

    const title = TYPE_TITLE[n.type] ?? "JagX Connect";
    const body  = String(n.content ?? "");
    const url   = (TYPE_URL[n.type] ?? (() => "/notifications"))(n);

    let sent = 0;
    await Promise.all(tokens.map(async (token) => {
      const r = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: {
            token,
            notification: { title, body },
            data: { url, type: String(n.type ?? "general"), notification_id: String(n.notification_id ?? "") },
            webpush: { fcm_options: { link: url }, notification: { title, body, icon: "/image-5 (1).jpg" } },
          }}),
        },
      );
      if (r.ok) sent++;
    }));
    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function b64url(b: Uint8Array | string) {
  const s = typeof b === "string" ? btoa(b) : btoa(String.fromCharCode(...b));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToPkcs8(pem: string) {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
async function getAccessToken(sa: { project_id: string; client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  return (await res.json()).access_token;
}