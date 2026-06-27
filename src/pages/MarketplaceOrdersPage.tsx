import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Coins, Package } from "lucide-react";
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

const MarketplaceOrdersPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"selling" | "buying">("selling");
  const [orders, setOrders] = useState<Order[]>([]);

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
        {orders.map((o) => (
          <div key={o.id} className="glass rounded-xl p-3 flex gap-3">
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
                <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
              </div>
              <p className="text-xs text-gold flex items-center gap-1">
                <Coins className="size-3" /> {o.total_coins} JagX × {o.quantity}
              </p>
              {tab === "selling" && (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    {o.buyer_name} · {o.buyer_phone}
                  </p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                    📍 {o.buyer_address}
                    {o.distance_km != null && ` (${o.distance_km} km)`}
                  </p>
                  {o.note && (
                    <p className="text-[11px] italic text-muted-foreground">"{o.note}"</p>
                  )}
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {o.status === "pending" && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]"
                        onClick={() => updateStatus(o.id, "accepted")}>Accept</Button>
                    )}
                    {o.status === "accepted" && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]"
                        onClick={() => updateStatus(o.id, "out_for_delivery")}>Out for delivery</Button>
                    )}
                    {o.status === "out_for_delivery" && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]"
                        onClick={() => updateStatus(o.id, "delivered")}>Mark delivered</Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MarketplaceOrdersPage;