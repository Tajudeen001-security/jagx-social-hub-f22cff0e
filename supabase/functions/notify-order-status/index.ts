// Sends an FCM push to the *other* party of a marketplace order whenever its
// status changes. Caller must be authenticated and must be either the buyer
// or seller on the order — service-role lookup confirms this.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STATUS_LABEL: Record<string, string> = {
  pending: "Placed",
  accepted: "Paid",
  out_for_delivery: "Shipped",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const me = userData.user;

    const body = await req.json().catch(() => ({}));
    const orderId = String(body.order_id ?? "");
    const status = String(body.status ?? "");
    if (!orderId || !status) return json({ error: "order_id and status are required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: order, error: oErr } = await admin
      .from("marketplace_orders")
      .select("id, buyer_id, seller_id, listing_id, total_coins")
      .eq("id", orderId).maybeSingle();
    if (oErr || !order) return json({ error: "Order not found" }, 404);
    if (order.buyer_id !== me.id && order.seller_id !== me.id) {
      return json({ error: "Forbidden" }, 403);
    }
    const recipient = me.id === order.seller_id ? order.buyer_id : order.seller_id;

    // Write an in-app notification row (so the bell updates instantly).
    await admin.from("notifications").insert({
      user_id: recipient,
      from_user_id: me.id,
      type: "order_status",
      content: `Order ${STATUS_LABEL[status] ?? status}`,
    });

    // Fetch recipient's tokens and push via FCM HTTP v1 directly.
    const title = "Marketplace order update";
    const message = `Your order is now: ${STATUS_LABEL[status] ?? status}`;
    const url = "/marketplace/orders";
    const { data: tokRows } = await admin.from("push_tokens").select("token").eq("user_id", recipient);
    const tokens = (tokRows ?? []).map((r: any) => r.token).filter(Boolean);
    if (tokens.length === 0) return json({ ok: true, sent: 0, note: "no tokens" });

    const sa = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "{}");
    if (!sa.project_id) return json({ ok: true, sent: 0, note: "no service account" });
    sa.private_key = String(sa.private_key).replace(/\\n/g, "\n");
    const accessToken = await getAccessToken(sa);
    let sent = 0;
    await Promise.all(tokens.map(async (token) => {
      const r = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: {
            token,
            notification: { title, body: message },
            data: { url, order_id: orderId, status },
            webpush: { fcm_options: { link: url }, notification: { title, body: message, icon: "/image-5 (1).jpg" } },
          }}),
        },
      );
      if (r.ok) sent++;
    }));
    return json({ ok: true, sent, recipient });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function b64url(b: Uint8Array | string): string {
  const s = typeof b === "string" ? btoa(b) : btoa(String.fromCharCode(...b));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
async function getAccessToken(sa: { project_id: string; client_email: string; private_key: string }): Promise<string> {
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
  const data = await res.json();
  return data.access_token;
}