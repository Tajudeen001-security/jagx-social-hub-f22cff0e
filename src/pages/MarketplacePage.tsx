import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, MapPin, Coins, Package, ShoppingBag, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentPosition, distanceKm } from "@/lib/geolocation";

type Listing = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  category: string | null;
  price_coins: number;
  stock: number;
  image_url: string | null;
  pickup_address: string | null;
  lat: number | null;
  lng: number | null;
  delivery_fee_per_km: number;
  max_delivery_km: number;
  status: string;
  created_at: string;
};

const MarketplacePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<Listing[]>([]);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentPosition().then(setMe);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await (supabase as any)
        .from("marketplace_listings")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(100);
      if (mounted) {
        setListings((data as Listing[]) || []);
        setLoading(false);
      }
    };
    load();
    const ch = supabase
      .channel("marketplace-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "marketplace_listings" },
        () => load(),
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="sticky top-0 z-30 glass border-b border-[hsl(var(--glass-border))]">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gold">JagX Marketplace</h1>
            <p className="text-xs text-muted-foreground">
              {me ? "Sorted by distance" : "Enable location for delivery"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/invest")}
            >
              <TrendingUp className="size-4 mr-1" /> Invest
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/marketplace/orders")}
            >
              <ShoppingBag className="size-4 mr-1" /> Orders
            </Button>
            <Button
              size="sm"
              className="gold-gradient text-primary-foreground"
              onClick={() => navigate("/marketplace/new")}
            >
              <Plus className="size-4 mr-1" /> Post
            </Button>
          </div>
        </div>
      </header>

      <div className="p-3 grid grid-cols-2 gap-3">
        {loading && (
          <p className="col-span-2 text-center text-muted-foreground py-8">
            Loading listings…
          </p>
        )}
        {!loading && listings.length === 0 && (
          <div className="col-span-2 text-center py-16">
            <Package className="size-12 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No markets yet — be the first to post.
            </p>
          </div>
        )}
        {listings
          .map((l) => ({
            l,
            d:
              me && l.lat != null && l.lng != null
                ? distanceKm(me, { lat: l.lat, lng: l.lng })
                : null,
          }))
          .sort((a, b) => {
            if (a.d == null && b.d == null) return 0;
            if (a.d == null) return 1;
            if (b.d == null) return -1;
            return a.d - b.d;
          })
          .map(({ l, d }) => (
            <Link
              key={l.id}
              to={`/marketplace/${l.id}`}
              className="glass rounded-xl overflow-hidden hover:gold-glow transition"
            >
              <div className="aspect-square bg-muted">
                {l.image_url ? (
                  <img
                    src={l.image_url}
                    alt={l.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <Package className="size-10" />
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-sm font-medium line-clamp-1">{l.title}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="flex items-center gap-1 text-xs text-gold font-bold">
                    <Coins className="size-3" />
                    {l.price_coins}
                  </span>
                  {d != null && (
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5"
                    >
                      <MapPin className="size-2.5 mr-0.5" />
                      {d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`}
                    </Badge>
                  )}
                </div>
                {l.seller_id === user?.id && (
                  <span className="text-[10px] text-muted-foreground">
                    Your listing
                  </span>
                )}
              </div>
            </Link>
          ))}
      </div>

      <BottomNav />
    </div>
  );
};

export default MarketplacePage;