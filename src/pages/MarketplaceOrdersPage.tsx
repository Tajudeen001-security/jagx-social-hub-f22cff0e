import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Coins, MapPin, Package, Phone, Truck, User as UserIcon, Upload, ExternalLink, ShieldCheck, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type Order = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  quantity: number;
  total_coins: number;
  delivery_fee_coins: number;
  distance_km: number | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_address: string;
  note: string | null;
  status: string;
  created_at: string;
  payment_method?: string | null;
  payment_currency?: string | null;
  payment_amount?: string | null;
  receipt_url?: string | null;
  listing?: { title: string; image_url: string | null };
};

// Visible pipeline shown to both parties.
const STAGES = [
  { key: "placed", label: "Placed" },
  { key: "paid", label: "Paid" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
] as const;

// Map DB statuses to the displayed stage index.
const stageIndex = (s: string) => {
  switch (s) {
    case "awaiting_payment": return 0;         // Placed, waiting for buyer receipt
    case "awaiting_confirmation": return 0;    // Placed, waiting for seller confirmation
    case "pending": return 1; // payment already debited at order time → Paid
    case "accepted": return 1; // still paid, awaiting shipment
    case "out_for_delivery":
    case "shipped": return 2;
    case "delivered": return 3;
    case "cancelled": return -1;
    default: return 0;
  }
};

const MarketplaceOrdersPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"selling" | "buying">("selling");
  const [orders, setOrders] = useState<Order[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const load = async () => {
      const filterCol = tab === "selling" ? "seller_id" : "buyer_id";
      const { data } = await (supabase as any)
        .from("marketplace_orders")
        .select("*, listing:marketplace_listings(title, image_url)")
        .eq(filterCol, user.id)
        .order("created_at", { ascending: false });
      if (mounted) setOrders((data as Order[]) || []);
    };
    load();
    const ch = supabase
      .channel(`orders-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "marketplace_orders",
          filter: `${tab === "selling" ? "seller_id" : "buyer_id"}=eq.${user.id}`,
        },
        (payload) => {
          load();
          if (tab === "selling" && payload.eventType === "INSERT") {
            toast({ title: "🛒 New order!", description: "You just got a new order." });
          }
        },
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [user, tab]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await (supabase as any)
      .from("marketplace_orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else {
      supabase.functions.invoke("notify-order-status", { body: { order_id: id, status } })
        .catch((e) => console.warn("[notify-order-status] failed:", e));
    }
  };

  const receiptUrl = (path?: string | null) => {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return supabase.storage.from("order-receipts").getPublicUrl(path).data.publicUrl;
  };

  const uploadReceipt = async (order: Order, file: File) => {
    if (!user) return;
    setUploadingFor(order.id);
    try {
      const path = `${user.id}/${order.id}_${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("order-receipts").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { error } = await (supabase as any).rpc("submit_manual_order_receipt", {
        _order_id: order.id, _receipt_url: path,
      });
      if (error) throw error;
      toast({ title: "Receipt uploaded — waiting for seller to confirm." });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingFor(null);
    }
  };

  const confirmManualPayment = async (id: string) => {
    setConfirming(id);
    const { error } = await (supabase as any).rpc("confirm_manual_order_payment", { _order_id: id });
    setConfirming(null);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else toast({ title: "Payment confirmed. Order marked as Paid." });
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 glass border-b border-[hsl(var(--glass-border))] p-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-lg font-bold">My Orders</h1>
      </header>

      <div className="p-3 flex gap-2">
        <Button
          variant={tab === "selling" ? "default" : "outline"}
          size="sm"
          className={tab === "selling" ? "gold-gradient text-primary-foreground" : ""}
          onClick={() => setTab("selling")}
        >
          Selling
        </Button>
        <Button
          variant={tab === "buying" ? "default" : "outline"}
          size="sm"
          className={tab === "buying" ? "gold-gradient text-primary-foreground" : ""}
          onClick={() => setTab("buying")}
        >
          Buying
        </Button>
      </div>

      <div className="px-3 space-y-2">
        {orders.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">
            No orders yet.
          </p>
        )}
        {orders.map((o) => {
          const stage = stageIndex(o.status);
          const open = expanded === o.id;
          return (
            <div key={o.id} className="glass rounded-xl p-3 space-y-3">
              <button onClick={() => setExpanded(open ? null : o.id)} className="w-full flex gap-3 text-left">
                <div className="size-16 rounded-lg bg-muted overflow-hidden shrink-0">
                  {o.listing?.image_url ? (
                    <img src={o.listing.image_url} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <Package className="size-6 m-auto text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium line-clamp-1">{o.listing?.title}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {stage >= 0 ? STAGES[stage as 0|1|2|3].label : "Cancelled"}
                    </Badge>
                  </div>
                  <p className="text-xs text-gold flex items-center gap-1">
                    {o.payment_method === "manual"
                      ? <><Building2 className="size-3" /> {o.payment_amount || o.total_coins} {o.payment_currency || "manual"} × {o.quantity}</>
                      : <><Coins className="size-3" /> {o.total_coins} JagX × {o.quantity}</>}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(o.created_at).toLocaleString()}
                  </p>
                </div>
              </button>

              {/* Status timeline */}
              <div className="flex items-center gap-1">
                {STAGES.map((s, i) => {
                  const done = stage >= i && stage >= 0;
                  return (
                    <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`size-6 rounded-full flex items-center justify-center text-[10px] font-bold ${done ? "gold-gradient text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {done ? <Check className="size-3" /> : i + 1}
                      </div>
                      <span className={`text-[9px] uppercase tracking-wider ${done ? "text-gold" : "text-muted-foreground"}`}>{s.label}</span>
                      {i < STAGES.length - 1 && (
                        <div className={`absolute h-px ${done ? "bg-gold" : "bg-muted"}`} />
                      )}
                    </div>
                  );
                })}
              </div>

              {(open || tab === "selling") && (
                <div className="rounded-lg bg-surface/40 p-2 space-y-1 text-[11px]">
                  <p className="flex items-center gap-1"><UserIcon className="size-3 text-gold" /> {o.buyer_name || "Buyer"}</p>
                  {o.buyer_phone && (
                    <a href={`tel:${o.buyer_phone}`} className="flex items-center gap-1 text-gold">
                      <Phone className="size-3" /> {o.buyer_phone}
                    </a>
                  )}
                  <p className="flex items-start gap-1">
                    <MapPin className="size-3 mt-0.5 shrink-0" />
                    <span>{o.buyer_address}{o.distance_km != null && ` (${o.distance_km} km)`}</span>
                  </p>
                  {o.note && <p className="italic text-muted-foreground">“{o.note}”</p>}
                  {o.payment_method === "manual" && (
                    <p className="flex items-center gap-1 pt-1">
                      <Building2 className="size-3 text-gold" />
                      Manual · {o.payment_currency || "?"} · {o.payment_amount || o.total_coins}
                    </p>
                  )}
                  {receiptUrl(o.receipt_url) && (
                    <a href={receiptUrl(o.receipt_url)!} target="_blank" rel="noopener"
                      className="inline-flex items-center gap-1 text-gold pt-1">
                      <ExternalLink className="size-3" /> View payment receipt
                    </a>
                  )}
                </div>
              )}

              {/* Buyer receipt upload for manual orders */}
              {tab === "buying" && o.payment_method === "manual" &&
                (o.status === "awaiting_payment" || o.status === "awaiting_confirmation") && (
                <label className="flex items-center justify-center gap-2 w-full py-2 rounded-lg gold-gradient text-primary-foreground text-[11px] font-bold uppercase tracking-wider cursor-pointer">
                  <Upload className="size-3.5" />
                  {uploadingFor === o.id
                    ? "Uploading…"
                    : o.receipt_url ? "Replace receipt" : "Upload payment receipt"}
                  <input type="file" accept="image/*,application/pdf" className="hidden"
                    disabled={uploadingFor === o.id}
                    onChange={(e) => e.target.files?.[0] && uploadReceipt(o, e.target.files[0])} />
                </label>
              )}

              {tab === "selling" && (
                <div className="flex gap-1 flex-wrap">
                  {o.payment_method === "manual" && o.status === "awaiting_confirmation" && (
                    <Button size="sm" disabled={confirming === o.id}
                      className="h-7 text-[11px] gold-gradient text-primary-foreground"
                      onClick={() => confirmManualPayment(o.id)}>
                      <ShieldCheck className="size-3 mr-1" />
                      {confirming === o.id ? "Confirming…" : "Confirm payment received"}
                    </Button>
                  )}
                  {o.payment_method === "manual" && o.status === "awaiting_payment" && (
                    <span className="text-[11px] text-muted-foreground italic px-1">Waiting for buyer receipt…</span>
                  )}
                  {o.status === "pending" && (
                    <Button size="sm" className="h-7 text-[11px] gold-gradient text-primary-foreground"
                      onClick={() => updateStatus(o.id, "accepted")}>
                      Accept deal
                    </Button>
                  )}
                  {(o.status === "pending" || o.status === "accepted") && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]"
                      onClick={() => updateStatus(o.id, "out_for_delivery")}>
                      <Truck className="size-3 mr-1" /> Mark shipped
                    </Button>
                  )}
                  {o.status === "out_for_delivery" && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]"
                      onClick={() => updateStatus(o.id, "delivered")}>
                      Mark delivered
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MarketplaceOrdersPage;