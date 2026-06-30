// Generates a JRILICENSE PDF certificate, uploads it to the
// `investment-certs` storage bucket, and returns a public URL.
// Called by the admin approve flow.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Missing auth" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
    if (!roles?.some(r => r.role === "admin")) return json({ error: "Admin only" }, 403);

    const { application_id } = await req.json();
    if (!application_id) return json({ error: "application_id required" }, 400);

    const { data: app, error } = await admin
      .from("investment_applications")
      .select("*, investment_projects(*)")
      .eq("id", application_id).maybeSingle();
    if (error || !app) return json({ error: "Application not found" }, 404);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const helv = await pdf.embedFont(StandardFonts.HelveticaBold);
    const helvR = await pdf.embedFont(StandardFonts.Helvetica);
    const gold = rgb(0.78, 0.62, 0.18);
    const text = (t: string, x: number, y: number, size = 12, font = helvR, color = rgb(0,0,0)) =>
      page.drawText(t, { x, y, size, font, color });

    page.drawRectangle({ x: 24, y: 24, width: 564, height: 744, borderColor: gold, borderWidth: 3 });
    text("JRILICENSE", 240, 720, 22, helv, gold);
    text("Certificate of Investment", 180, 690, 18, helv);
    text(`Project: ${app.investment_projects.name}`, 60, 640, 14, helv);
    text(`Certificate ID: ${app.id}`, 60, 615);
    text(`Date issued: ${new Date().toISOString().slice(0,10)}`, 60, 595);

    text("Investor", 60, 560, 13, helv);
    text(`Name:    ${app.full_name}`, 60, 540);
    text(`Email:   ${app.email}`, 60, 522);
    text(`Phone:   ${app.phone}`, 60, 504);
    text(`Country: ${app.country}`, 60, 486);
    text(`Gov ID:  ${app.gov_id}`, 60, 468);

    text("Holdings", 60, 430, 13, helv);
    text(`Shares:        ${app.shares}`, 60, 410);
    text(`Equity:        ${Number(app.equity_pct).toFixed(5)}%`, 60, 392);
    text(`Amount paid:   ${app.amount_jagx} JagX`, 60, 374);
    text(`Project total: ${app.investment_projects.total_shares} shares (${app.investment_projects.equity_total_pct}%)`, 60, 356);

    text("Terms", 60, 310, 13, helv);
    const terms = "This certificate confirms equity participation in the named JRI project. Shares are non-transferable without written consent of JRI. Holder is bound by the JRILICENSE master agreement.";
    let y = 290;
    for (const line of wrap(terms, 80)) { text(line, 60, y); y -= 14; }

    text("Admin signature on file. Investor signature attached in records.", 60, 130, 10, helvR, rgb(0.4,0.4,0.4));
    text("— JRI Holdings —", 230, 80, 12, helv, gold);

    const bytes = await pdf.save();
    const path = `${app.user_id}/${app.id}.pdf`;
    const { error: upErr } = await admin.storage.from("investment-certs").upload(path, bytes, {
      contentType: "application/pdf", upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);
    const { data: pub } = admin.storage.from("investment-certs").getPublicUrl(path);
    return json({ ok: true, url: pub.publicUrl, path });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function wrap(s: string, n: number) {
  const out: string[] = []; const words = s.split(/\s+/); let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > n) { out.push(line.trim()); line = w; }
    else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}