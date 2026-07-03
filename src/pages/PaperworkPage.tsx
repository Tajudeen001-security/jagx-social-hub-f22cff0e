import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, ShoppingBag, Store, Receipt, Download, ExternalLink, Package, Eye, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";

type Preview = { url: string; title: string; kind: "image" | "pdf" | "other" };

const kindOf = (url: string): Preview["kind"] => {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(clean)) return "image";
  if (/\.pdf$/.test(clean)) return "pdf";
  return "other";
};

const forceDownloadName = (url: string, fallback: string) => {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || fallback;
    return last.includes(".") ? last : fallback;
  } catch { return fallback; }
};

type Tab = "certificates" | "buying" | "selling" | "receipts";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-300",
  awaiting_payment: "bg-yellow-500/20 text-yellow-300",
  awaiting_confirmation: "bg-blue-500/20 text-blue-300",
  accepted: "bg-emerald-500/20 text-emerald-300",
  out_for_delivery: "bg-emerald-500/20 text-emerald-300",
  delivered: "bg-green-500/20 text-green-300",
  approved: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
  cancelled: "bg-red-500/20 text-red-300",
};

const Pill = ({ s }: { s: string }) => (
  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_COLOR[s] || "bg-muted text-muted-foreground"}`}>
    {s.replace(/_/g, " ")}
  </span>
);

const PaperworkPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("certificates");
  const [certs, setCerts] = useState<any[]>([]);
  const [buying, setBuying] = useState<any[]>([]);
  const [selling, setSelling] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    if (!user) return;
    const loadCerts = async () => {
      const { data } = await (supabase as any)
        .from("investment_applications")
        .select("*, investment_projects(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setCerts(data || []);
    };
    const loadOrders = async () => {
      const { data: b } = await (supabase as any)
        .from("marketplace_orders")
        .select("*, listing:marketplace_listings(title, image_url)")
        .eq("buyer_id", user.id).order("created_at", { ascending: false });
      const { data: s } = await (supabase as any)
        .from("marketplace_orders")
        .select("*, listing:marketplace_listings(title, image_url)")
        .eq("seller_id", user.id).order("created_at", { ascending: false });
      setBuying(b || []);
      setSelling(s || []);
    };
    const loadReceipts = async () => {
      const { data } = await supabase
        .from("coin_transactions")
        .select("id, amount, status, transaction_type, receipt_url, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setReceipts(data || []);
    };
    loadCerts(); loadOrders(); loadReceipts();
    const ch = supabase.channel(`paperwork-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "investment_applications", filter: `user_id=eq.${user.id}` }, loadCerts)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_orders", filter: `buyer_id=eq.${user.id}` }, loadOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_orders", filter: `seller_id=eq.${user.id}` }, loadOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "coin_transactions", filter: `user_id=eq.${user.id}` }, loadReceipts)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const receiptPublicUrl = (path: string | null) => {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("receipts").getPublicUrl(path);
    return data.publicUrl;
  };

  return (
    <div className="min-h-screen pb-24 bg-background">
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft className="size-5" /></button>
          <div className="min-w-0">
            <h1 className="font-display italic text-lg text-gold leading-tight">My Paperwork</h1>
            <p className="text-[11px] text-muted-foreground truncate">Certificates, orders & receipts in one place</p>
          </div>
        </div>
        <div className="flex gap-1 px-2 pb-2 overflow-x-auto scrollbar-none">
          {([
            { k: "certificates", i: <FileText className="size-3.5" />, l: "Certificates" },
            { k: "buying", i: <ShoppingBag className="size-3.5" />, l: "Buying" },
            { k: "selling", i: <Store className="size-3.5" />, l: "Selling" },
            { k: "receipts", i: <Receipt className="size-3.5" />, l: "Receipts" },
          ] as const).map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border transition ${
                tab === t.k
                  ? "bg-primary/15 text-gold border-primary/60"
                  : "bg-surface text-muted-foreground border-border"
              }`}>{t.i}{t.l}</button>
          ))}
        </div>
      </header>

      <div className="p-4 space-y-3">
        {tab === "certificates" && (
          <>
            {certs.length === 0 && <Empty label="You don't have any investment paperwork yet." cta="Browse projects" onCta={() => navigate("/invest")} />}
            {certs.map(r => (
              <div key={r.id} className="p-4 rounded-2xl bg-surface border border-border/50 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-champagne">{r.investment_projects?.name}</h2>
                  <Pill s={r.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.shares} shares · {Number(r.equity_pct).toFixed(5)}% · {r.amount_jagx} JagX
                </p>
                {r.admin_note && <p className="text-xs text-muted-foreground italic">Note: {r.admin_note}</p>}
                {r.certificate_url ? (
                  <FileActions
                    url={r.certificate_url}
                    title={`${r.investment_projects?.name || "Investment"} — JRILICENSE`}
                    downloadLabel="Download JRILICENSE PDF"
                    onPreview={setPreview}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground italic">Certificate becomes available after admin approval.</p>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "buying" && (
          <>
            {buying.length === 0 && <Empty label="No purchases yet." cta="Open marketplace" onCta={() => navigate("/marketplace")} />}
            {buying.map(o => <OrderCard key={o.id} o={o} role="buyer" onPreview={setPreview} />)}
          </>
        )}

        {tab === "selling" && (
          <>
            {selling.length === 0 && <Empty label="You haven't sold anything yet." cta="Post a listing" onCta={() => navigate("/marketplace/new")} />}
            {selling.map(o => <OrderCard key={o.id} o={o} role="seller" onPreview={setPreview} />)}
          </>
        )}

        {tab === "receipts" && (
          <>
            {receipts.length === 0 && <Empty label="No coin purchase receipts yet." cta="Buy JagX" onCta={() => navigate("/coins")} />}
            {receipts.map(t => {
              const url = receiptPublicUrl(t.receipt_url);
              return (
                <div key={t.id} className="p-4 rounded-2xl bg-surface border border-border/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-champagne capitalize">{t.transaction_type.replace(/_/g, " ")}</h2>
                    <Pill s={t.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.amount > 0 ? `${t.amount} JagX · ` : ""}{new Date(t.created_at).toLocaleString()}
                  </p>
                  {url && (
                    <FileActions
                      url={url}
                      title={`Coin purchase receipt — ${new Date(t.created_at).toLocaleDateString()}`}
                      downloadLabel="Download receipt"
                      onPreview={setPreview}
                    />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {preview && <PreviewModal p={preview} onClose={() => setPreview(null)} />}
      <BottomNav />
    </div>
  );
};

const Empty = ({ label, cta, onCta }: { label: string; cta: string; onCta: () => void }) => (
  <div className="text-center py-16 px-4">
    <FileText className="size-10 mx-auto text-muted-foreground mb-3" />
    <p className="text-sm text-muted-foreground mb-4">{label}</p>
    <button onClick={onCta}
      className="px-4 py-2 rounded-full gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-wider">
      {cta}
    </button>
  </div>
);

const OrderCard = ({ o, role, onPreview }: { o: any; role: "buyer" | "seller"; onPreview: (p: Preview) => void }) => {
  const dateLine = new Date(o.created_at).toLocaleString();
  const receiptUrl = o.receipt_url && !o.receipt_url.startsWith("http")
    ? supabase.storage.from("order-receipts").getPublicUrl(o.receipt_url).data.publicUrl
    : o.receipt_url;
  return (
    <div className="p-3 rounded-2xl bg-surface border border-border/50 space-y-2">
      <div className="flex gap-3">
        <div className="size-14 rounded-lg bg-muted overflow-hidden shrink-0">
          {o.listing?.image_url
            ? <img src={o.listing.image_url} alt="" className="w-full h-full object-cover" />
            : <Package className="size-6 m-auto text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-champagne line-clamp-1">{o.listing?.title || "Listing"}</p>
            <Pill s={o.status} />
          </div>
          <p className="text-xs text-gold font-bold">{o.total_coins} {o.payment_method === "manual" ? (o.payment_currency || "manual") : "JagX"} × {o.quantity}</p>
          <p className="text-[10px] text-muted-foreground">{dateLine}</p>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground space-y-0.5">
        <p><b>{role === "buyer" ? "Deliver to" : "Buyer"}:</b> {o.buyer_name || "—"}</p>
        <p><b>Address:</b> {o.buyer_address}</p>
        {o.buyer_phone && <p><b>Phone:</b> <a href={`tel:${o.buyer_phone}`} className="text-gold">{o.buyer_phone}</a></p>}
        <p><b>Payment:</b> {o.payment_method === "manual" ? `Manual ${o.payment_currency || ""}` : "JagX Coins"}</p>
      </div>
      {receiptUrl && (
        <FileActions
          url={receiptUrl}
          title={`Payment receipt — ${o.listing?.title || "Order"}`}
          downloadLabel="Download receipt"
          onPreview={onPreview}
        />
      )}
    </div>
  );
};

const FileActions = ({ url, title, downloadLabel, onPreview }: {
  url: string; title: string; downloadLabel: string; onPreview: (p: Preview) => void;
}) => {
  const kind = kindOf(url);
  const filename = forceDownloadName(url, `${title.replace(/\s+/g, "-").toLowerCase()}${kind === "pdf" ? ".pdf" : kind === "image" ? ".jpg" : ""}`);
  return (
    <div className="mt-2 space-y-2">
      {kind === "image" && (
        <button onClick={() => onPreview({ url, title, kind })}
          className="block w-full rounded-lg overflow-hidden border border-border/60 bg-background">
          <img src={url} alt={title} className="w-full max-h-48 object-cover" />
        </button>
      )}
      {kind === "pdf" && (
        <button onClick={() => onPreview({ url, title, kind })}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-left">
          <div className="size-8 rounded bg-red-500/15 text-red-300 flex items-center justify-center text-[10px] font-bold">PDF</div>
          <p className="text-xs text-champagne truncate flex-1">{filename}</p>
          <Eye className="size-3.5 text-muted-foreground" />
        </button>
      )}
      <div className="flex gap-2">
        <button onClick={() => onPreview({ url, title, kind })}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-background border border-border text-xs font-semibold text-champagne">
          <Eye className="size-3.5" /> Preview
        </button>
        <a href={url} target="_blank" rel="noopener" download={filename}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-wider">
          <Download className="size-3.5" /> {downloadLabel}
        </a>
      </div>
    </div>
  );
};

const PreviewModal = ({ p, onClose }: { p: Preview; onClose: () => void }) => (
  <div className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-xl flex flex-col">
    <div className="flex items-center gap-3 px-4 h-14 border-b border-border/40">
      <button onClick={onClose} aria-label="Close"><X className="size-5" /></button>
      <p className="text-sm font-semibold text-champagne truncate flex-1">{p.title}</p>
      <a href={p.url} target="_blank" rel="noopener" download
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full gold-gradient text-primary-foreground text-[11px] font-bold uppercase tracking-wider">
        <Download className="size-3.5" /> Save
      </a>
    </div>
    <div className="flex-1 overflow-auto bg-black/40 flex items-center justify-center">
      {p.kind === "image" && <img src={p.url} alt={p.title} className="max-w-full max-h-full object-contain" />}
      {p.kind === "pdf" && <iframe src={p.url} title={p.title} className="w-full h-full min-h-[70vh] bg-white" />}
      {p.kind === "other" && (
        <div className="text-center p-8 space-y-3">
          <p className="text-sm text-muted-foreground">Preview not supported for this file type.</p>
          <a href={p.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-xs text-gold font-semibold">
            <ExternalLink className="size-3.5" /> Open in new tab
          </a>
        </div>
      )}
    </div>
  </div>
);

export default PaperworkPage;