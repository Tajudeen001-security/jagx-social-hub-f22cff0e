import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Coins, MapPin, Package, Phone, User as UserIcon, Wallet, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { getCurrentPosition, distanceKm } from "@/lib/geolocation";
import PaymentAccounts from "@/components/PaymentAccounts";

type Listing = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price_coins: number;
  stock: number;
  image_url: string | null;
  pickup_address: string | null;
  lat: number | null;
  lng: number | null;
  delivery_fee_per_km: number;
  max_delivery_km: number;
  status: string;
};

const ListingDetailPage = () => {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [listing, setListing] = useState<Listing | null>(null);
  const [seller, setSeller] = useState<{ display_name: string | null; username: string | null; avatar_url: string | null } | null>(null);
  const [myProfile, setMyProfile] = useState<any>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", note: "" });
  const [payMethod, setPayMethod] = useState<"jagx" | "manual">("jagx");
  const [payCurrency, setPayCurrency] = useState<string>("USD");

  useEffect(() => {
    if (!listingId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("marketplace_listings")
        .select("*")
        .eq("id", listingId)
        .maybeSingle();
      setListing(data as Listing | null);
      if (data?.seller_id) {
        const { data: p } = await supabase
          .from("profiles")
          .select("display_name, username, avatar_url")
          .eq("user_id", data.seller_id)
          .maybeSingle();
        setSeller(p as any);
      }
    })();
  }, [listingId]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      setMyProfile(data);
      setForm((f) => ({
        ...f,
        name: (data as any)?.display_name || (data as any)?.first_name || "",
        phone: (data as any)?.phone || "",
        address: (data as any)?.delivery_address || (data as any)?.address || "",
      }));
      const dl = (data as any)?.delivery_lat;
      const dn = (data as any)?.delivery_lng;
      if (dl != null && dn != null) setCoords({ lat: dl, lng: dn });
      else getCurrentPosition().then((c) => c && setCoords(c));
    })();
  }, [user]);

  const distance = useMemo(() => {
    if (!listing?.lat || !listing?.lng || !coords) return null;
    return distanceKm(coords, { lat: listing.lat, lng: listing.lng });
  }, [listing, coords]);

  const deliveryFee = useMemo(() => {
    if (distance == null || !listing) return 0;
    return Math.ceil(distance * listing.delivery_fee_per_km);
  }, [distance, listing]);

  const subtotal = (listing?.price_coins || 0) * qty;
  const total = subtotal + deliveryFee;

  const buy = async () => {
    if (!user || !listing) return;
    if (!form.address.trim()) {
      toast({ title: "Delivery address required", variant: "destructive" });
      return;
    }
    if (payMethod === "jagx" && (myProfile?.jagx_coins ?? 0) < total) {
      toast({ title: "Not enough JagX coins", description: `You need ${total}`, variant: "destructive" });
      return;
    }
    if (distance != null && distance > listing.max_delivery_km) {
      toast({ title: "Outside delivery range", variant: "destructive" });
      return;
    }
    setBuying(true);
    try {
      await supabase
        .from("profiles")
        .update({
          phone: form.phone,
          delivery_address: form.address,
          delivery_lat: coords?.lat ?? null,
          delivery_lng: coords?.lng ?? null,
        } as any)
        .eq("user_id", user.id);

      if (payMethod === "jagx") {
        const { error } = await (supabase as any).rpc("place_marketplace_order", {
          _listing_id: listing.id, _quantity: qty,
          _buyer_name: form.name, _buyer_phone: form.phone, _buyer_address: form.address,
          _buyer_lat: coords?.lat ?? null, _buyer_lng: coords?.lng ?? null, _note: form.note,
        });
        if (error) throw error;
        toast({ title: "Order placed! Seller has been notified." });
      } else {
        const { error } = await (supabase as any).rpc("place_manual_marketplace_order", {
          _listing_id: listing.id, _quantity: qty,
          _buyer_name: form.name, _buyer_phone: form.phone, _buyer_address: form.address,
          _buyer_lat: coords?.lat ?? null, _buyer_lng: coords?.lng ?? null, _note: form.note,
          _payment_currency: payCurrency, _payment_amount: String(total),
        });
        if (error) throw error;
        toast({ title: "Order reserved", description: "Pay the seller, then upload your receipt from Orders." });
      }
      navigate("/marketplace/orders");
    } catch (e: any) {
      toast({ title: "Order failed", description: e.message, variant: "destructive" });
    } finally {
      setBuying(false);
    }
  };

  if (!listing) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const isOwn = listing.seller_id === user?.id;

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-30 glass border-b border-[hsl(var(--glass-border))] p-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-lg font-bold line-clamp-1">{listing.title}</h1>
      </header>

      <div className="aspect-video bg-muted">
        {listing.image_url ? (
          <img src={listing.image_url} alt={listing.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Package className="size-14" />
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-2xl font-bold text-gold">
            <Coins className="size-5" />
            {listing.price_coins} JagX
          </span>
          <span className="text-xs text-muted-foreground">
            {listing.stock} in stock
          </span>
        </div>
        {seller && (
          <button
            onClick={() => navigate(`/user/${listing.seller_id}`)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Sold by @{seller.username || seller.display_name || "seller"}
          </button>
        )}
        {listing.description && (
          <p className="text-sm whitespace-pre-wrap">{listing.description}</p>
        )}
        {listing.pickup_address && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="size-3" /> Pickup: {listing.pickup_address}
            {distance != null && ` · ${distance.toFixed(2)} km from you`}
          </p>
        )}
      </div>

      {!isOwn && listing.status === "active" && (
        <div className="px-4 space-y-3">
          <h2 className="text-base font-semibold">Delivery details</h2>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <UserIcon className="size-3" /> Full name
            </Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <Phone className="size-3" /> Phone
            </Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <MapPin className="size-3" /> Delivery address
            </Label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {coords ? "Location attached for distance pricing" : "Allow location for distance pricing"}
            </p>
          </div>
          <div>
            <Label className="text-xs">Note for seller</Label>
            <Textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Optional"
              maxLength={500}
            />
          </div>
          <div>
            <Label className="text-xs">Quantity</Label>
            <Input
              type="number"
              min={1}
              max={listing.stock}
              value={qty}
              onChange={(e) =>
                setQty(Math.max(1, Math.min(listing.stock, Number(e.target.value))))
              }
            />
          </div>

          <div className="glass rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{subtotal} JagX</span>
            </div>
            <div className="flex justify-between">
              <span>
                Delivery {distance != null && `(${distance.toFixed(2)} km)`}
              </span>
              <span>{deliveryFee} JagX</span>
            </div>
            <div className="flex justify-between font-bold text-gold pt-1 border-t border-[hsl(var(--glass-border))]">
              <span>Total</span>
              <span>{total} JagX</span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1">
              Your balance: {myProfile?.jagx_coins ?? 0} JagX
            </p>
          </div>

          {/* Payment method */}
          <div>
            <Label className="text-xs mb-1 block">Payment method</Label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPayMethod("jagx")}
                className={`p-3 rounded-xl border text-left transition ${
                  payMethod === "jagx" ? "border-primary bg-primary/10" : "border-border bg-surface"
                }`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-champagne">
                  <Coins className="size-4 text-gold" /> JagX Coins
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Instant, on-platform</p>
              </button>
              <button type="button" onClick={() => setPayMethod("manual")}
                className={`p-3 rounded-xl border text-left transition ${
                  payMethod === "manual" ? "border-primary bg-primary/10" : "border-border bg-surface"
                }`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-champagne">
                  <Building2 className="size-4 text-gold" /> Manual
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Bank / crypto + receipt</p>
              </button>
            </div>
          </div>

          {payMethod === "manual" && (
            <>
              <div>
                <Label className="text-xs mb-1 block">Pay in</Label>
                <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
                  {["USD","GBP","EUR","USDC-BEP20","USDT-BEP20","USDT-TRC20"].map(c => (
                    <button key={c} type="button" onClick={() => setPayCurrency(c)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border transition ${
                        payCurrency === c ? "bg-primary/15 text-gold border-primary/60" : "bg-surface text-muted-foreground border-border"
                      }`}>{c}</button>
                  ))}
                </div>
              </div>
              <PaymentAccounts note={`Pay approximately ${total} JagX-equivalent in ${payCurrency}, then upload your receipt after placing the order.`} />
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Wallet className="size-3 mt-0.5 shrink-0" />
                Order reserves stock. The seller releases it after confirming your payment.
              </p>
            </>
          )}

          <Button
            className="w-full gold-gradient text-primary-foreground"
            disabled={buying}
            onClick={buy}
          >
            {buying
              ? "Placing order…"
              : payMethod === "jagx"
                ? `Pay ${total} JagX & Order`
                : `Reserve order · Pay in ${payCurrency}`}
          </Button>
        </div>
      )}

      {isOwn && (
        <div className="px-4">
          <p className="text-sm text-muted-foreground">This is your listing.</p>
          <Button variant="outline" className="mt-2 w-full" onClick={() => navigate("/marketplace/orders")}>
            View orders
          </Button>
        </div>
      )}
    </div>
  );
};

export default ListingDetailPage;