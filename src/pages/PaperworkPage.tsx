import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, ShoppingBag, Store, Receipt, Download, ExternalLink, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";

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
                  <a href={r.certificate_url} target="_blank" rel="noopener" download
                    className="mt-1 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-wider">
                    <Download className="size-3.5" /> Download JRILICENSE PDF
                  </a>
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
            {buying.map(o => <OrderCard key={o.id} o={o} role="buyer" />)}
          </>
        )}

        {tab === "selling" && (
          <>
            {selling.length === 0 && <Empty label="You haven't sold anything yet." cta="Post a listing" onCta={() => navigate("/marketplace/new")} />}
            {selling.map(o => <OrderCard key={o.id} o={o} role="seller" />)}
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
                    <a href={url} target="_blank" rel="noopener"
                      className="inline-flex items-center gap-1.5 text-xs text-gold font-semibold">
                      <ExternalLink className="size-3" /> View receipt
                    </a>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

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

const OrderCard = ({ o, role }: { o: any; role: "buyer" | "seller" }) => {
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
        <a href={receiptUrl} target="_blank" rel="noopener"
          className="inline-flex items-center gap-1.5 text-xs text-gold font-semibold">
          <ExternalLink className="size-3" /> View payment receipt
        </a>
      )}
    </div>
  );
};

export default PaperworkPage;