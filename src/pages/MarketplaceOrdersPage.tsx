import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Coins, MapPin, Package, Phone, Truck, User as UserIcon } from "lucide-react";
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
      // Push the other party (and write an in-app notification row).
      supabase.functions.invoke("notify-order-status", { body: { order_id: id, status } })
        .catch((e) => console.warn("[notify-order-status] failed:", e));
    }
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
                    <Coins className="size-3" /> {o.total_coins} JagX × {o.quantity}
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
                </div>
              )}

              {tab === "selling" && (
                <div className="flex gap-1 flex-wrap">
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