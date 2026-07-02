import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus, MapPin, Coins, Package, ShoppingBag, TrendingUp,
  Search, Truck, Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

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
    <MarketplaceView
      listings={listings}
      me={me}
      loading={loading}
      user={user}
      navigate={navigate}
      query={query}
      setQuery={setQuery}
      category={category}
      setCategory={setCategory}
    />
  );
};

function MarketplaceView({
  listings, me, loading, user, navigate, query, setQuery, category, setCategory,
}: any) {
  const categories = useMemo(() => {
    const s = new Set<string>();
    listings.forEach((l: Listing) => l.category && s.add(l.category));
    return ["all", ...Array.from(s)];
  }, [listings]);

  const withDist = useMemo(() => listings.map((l: Listing) => ({
    l,
    d: me && l.lat != null && l.lng != null ? distanceKm(me, { lat: l.lat!, lng: l.lng! }) : null,
  })), [listings, me]);

  const filtered = withDist
    .filter(({ l }: any) => category === "all" || l.category === category)
    .filter(({ l }: any) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return l.title.toLowerCase().includes(q) || (l.description || "").toLowerCase().includes(q);
    })
    .sort((a: any, b: any) => {
      if (a.d == null && b.d == null) return 0;
      if (a.d == null) return 1;
      if (b.d == null) return -1;
      return a.d - b.d;
    });

  const featured = filtered.slice(0, 4);

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border/40">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-display italic text-gold leading-tight">JagX Market</h1>
            <p className="text-[11px] text-muted-foreground truncate">
              {me ? "Sorted by nearest delivery" : "Enable location for delivery estimates"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigate("/invest")}
              className="size-9 rounded-full bg-surface border border-border flex items-center justify-center"
              aria-label="Invest"
            ><TrendingUp className="size-4 text-gold" /></button>
            <button
              onClick={() => navigate("/marketplace/orders")}
              className="size-9 rounded-full bg-surface border border-border flex items-center justify-center"
              aria-label="Orders"
            ><ShoppingBag className="size-4 text-champagne" /></button>
            <button
              onClick={() => navigate("/marketplace/new")}
              className="h-9 px-3 rounded-full gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-wider flex items-center gap-1"
            ><Plus className="size-3.5" /> Sell</button>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search listings"
              className="pl-9 h-10 rounded-full bg-surface border-border"
            />
          </div>
        </div>
        {categories.length > 1 && (
          <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-none">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border transition ${
                  category === c
                    ? "bg-primary/15 text-gold border-primary/60"
                    : "bg-surface text-muted-foreground border-border"
                }`}
              >{c}</button>
            ))}
          </div>
        )}
      </header>

      {loading && (
        <p className="text-center text-sm text-muted-foreground py-16">Loading listings…</p>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-20 px-6">
          <Package className="size-14 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-champagne font-semibold mb-1">No listings yet</p>
          <p className="text-xs text-muted-foreground mb-5">Post something and reach buyers near you.</p>
          <button
            onClick={() => navigate("/marketplace/new")}
            className="px-5 py-2.5 rounded-full gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5"
          ><Plus className="size-3.5" /> Post first listing</button>
        </div>
      )}

      {!loading && featured.length > 0 && (
        <section className="pt-3">
          <div className="px-4 flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-gold" />
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Featured near you</p>
            </div>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-none px-4 pb-1 snap-x snap-mandatory">
            {featured.map(({ l, d }: any) => (
              <Link
                key={l.id}
                to={`/marketplace/${l.id}`}
                className="snap-start shrink-0 w-[68%] rounded-2xl overflow-hidden bg-surface border border-border relative"
              >
                <div className="aspect-[4/3] bg-muted relative">
                  {l.image_url ? (
                    <img src={l.image_url} alt={l.title} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Package className="size-10" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                    <p className="text-sm text-white font-semibold line-clamp-1">{l.title}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="flex items-center gap-1 text-xs text-gold font-bold">
                        <Coins className="size-3" />{l.price_coins}
                      </span>
                      {d != null && (
                        <span className="text-[10px] text-white/80 flex items-center gap-0.5">
                          <MapPin className="size-2.5" />
                          {d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loading && filtered.length > 0 && (
        <section className="pt-4">
          <div className="px-4 mb-2">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              All listings · {filtered.length}
            </p>
          </div>
          <div className="px-3 grid grid-cols-2 gap-3">
            {filtered.map(({ l, d }: any) => (
              <Link
                key={l.id}
                to={`/marketplace/${l.id}`}
                className="group rounded-2xl overflow-hidden bg-surface border border-border active:scale-[0.98] transition-transform"
              >
                <div className="aspect-square bg-muted relative">
                  {l.image_url ? (
                    <img src={l.image_url} alt={l.title} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Package className="size-10" />
                    </div>
                  )}
                  {l.seller_id === user?.id && (
                    <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-wider bg-black/60 text-gold px-1.5 py-0.5 rounded">
                      Yours
                    </span>
                  )}
                  {l.stock <= 0 && (
                    <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider bg-red-500/80 text-white px-1.5 py-0.5 rounded">
                      Sold
                    </span>
                  )}
                </div>
                <div className="p-2.5 space-y-1">
                  <p className="text-sm font-semibold text-champagne line-clamp-1">{l.title}</p>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-sm text-gold font-bold">
                      <Coins className="size-3.5" />{l.price_coins}
                    </span>
                    {d != null && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-border">
                        <MapPin className="size-2.5 mr-0.5" />
                        {d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`}
                      </Badge>
                    )}
                  </div>
                  {l.delivery_fee_per_km > 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Truck className="size-2.5" />
                      {l.delivery_fee_per_km} JagX/km · up to {l.max_delivery_km}km
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <BottomNav />
    </div>
  );
}

export default MarketplacePage;