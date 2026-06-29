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

    // Reuse the existing send-push function via service role headers.
    const title = "Marketplace order update";
    const message = `Your order is now: ${STATUS_LABEL[status] ?? status}`;
    const url = "/marketplace/orders";
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ user_ids: [recipient], title, body: message, url }),
    });
    const text = await res.text();
    return json({ ok: res.ok, push: text });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});