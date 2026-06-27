import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { getCurrentPosition } from "@/lib/geolocation";

const CreateListingPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    price_coins: 10,
    stock: 1,
    pickup_address: "",
    delivery_fee_per_km: 1,
    max_delivery_km: 50,
  });

  useEffect(() => {
    getCurrentPosition().then((c) => {
      if (c) setCoords(c);
    });
  }, []);

  const handleImage = (f: File | null) => {
    setImageFile(f);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!user) return;
    if (!form.title.trim() || form.price_coins < 0) {
      toast({ title: "Title and price are required", variant: "destructive" });
      return;
    }
    if (!form.pickup_address.trim()) {
      toast({ title: "Pickup address is required" });
      return;
    }
    setSubmitting(true);
    try {
      let image_url: string | null = null;
      if (imageFile) {
        const path = `${user.id}/${Date.now()}-${imageFile.name}`;
        const { error } = await supabase.storage
          .from("posts")
          .upload(path, imageFile, { upsert: true });
        if (!error) {
          image_url = supabase.storage.from("posts").getPublicUrl(path).data.publicUrl;
        }
      }
      const { error } = await (supabase as any)
        .from("marketplace_listings")
        .insert({
          seller_id: user.id,
          title: form.title.trim(),
          description: form.description.trim() || null,
          category: form.category.trim() || null,
          price_coins: Math.floor(form.price_coins),
          stock: Math.floor(form.stock),
          image_url,
          pickup_address: form.pickup_address.trim(),
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          delivery_fee_per_km: Math.max(0, Math.floor(form.delivery_fee_per_km)),
          max_delivery_km: Math.max(1, Math.floor(form.max_delivery_km)),
        });
      if (error) throw error;
      toast({ title: "Listing posted live!" });
      navigate("/marketplace");
    } catch (e: any) {
      toast({ title: "Failed to post", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 glass border-b border-[hsl(var(--glass-border))] p-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-lg font-bold">Post to Marketplace</h1>
      </header>

      <div className="p-4 space-y-4 max-w-xl mx-auto">
        <div>
          <Label>Product image</Label>
          <label className="mt-1 flex aspect-video items-center justify-center rounded-xl border border-dashed border-[hsl(var(--glass-border))] bg-muted/30 cursor-pointer overflow-hidden">
            {imagePreview ? (
              <img src={imagePreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center text-muted-foreground">
                <Upload className="size-6 mx-auto mb-1" />
                <span className="text-xs">Tap to upload</span>
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleImage(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div>
          <Label>Title *</Label>
          <Input
            value={form.title}
            maxLength={100}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Fresh jollof rice plate"
          />
        </div>

        <div>
          <Label>Description</Label>
          <Textarea
            value={form.description}
            maxLength={1000}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What you're selling, condition, options…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Price (JagX) *</Label>
            <Input
              type="number"
              min={0}
              value={form.price_coins}
              onChange={(e) =>
                setForm({ ...form, price_coins: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label>Stock</Label>
            <Input
              type="number"
              min={1}
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
            />
          </div>
        </div>

        <div>
          <Label>Category</Label>
          <Input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="Food, Fashion, Electronics…"
          />
        </div>

        <div>
          <Label>Pickup address *</Label>
          <Input
            value={form.pickup_address}
            onChange={(e) => setForm({ ...form, pickup_address: e.target.value })}
            placeholder="Street, city"
          />
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="size-3" />
            {coords
              ? `Location captured (${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)})`
              : "Allow location to enable distance-based delivery"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Delivery fee / km (JagX)</Label>
            <Input
              type="number"
              min={0}
              value={form.delivery_fee_per_km}
              onChange={(e) =>
                setForm({ ...form, delivery_fee_per_km: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label>Max delivery (km)</Label>
            <Input
              type="number"
              min={1}
              value={form.max_delivery_km}
              onChange={(e) =>
                setForm({ ...form, max_delivery_km: Number(e.target.value) })
              }
            />
          </div>
        </div>

        <Button
          className="w-full gold-gradient text-primary-foreground"
          disabled={submitting}
          onClick={submit}
        >
          {submitting ? "Posting…" : "Post Listing"}
        </Button>
      </div>
    </div>
  );
};

export default CreateListingPage;