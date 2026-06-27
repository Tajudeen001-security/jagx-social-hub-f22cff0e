import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, Share2, Coins, Users, Lock, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";

const AffiliatePage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [code, setCode] = useState<string>("");
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [redeem, setRedeem] = useState("");
  const [hasOwnRedemption, setHasOwnRedemption] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data: prof } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
    if ((prof as any)?.invite_code) setCode((prof as any).invite_code);

    const { data: refs } = await supabase
      .from("referrals" as any)
      .select("*")
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false });
    setReferrals(refs || []);

    const { data: own } = await supabase
      .from("referrals" as any)
      .select("id")
      .eq("referred_id", user.id)
      .maybeSingle();
    setHasOwnRedemption(!!own);
  };

  useEffect(() => { load(); }, [user]);

  const inviteUrl = code ? `${window.location.origin}/auth?invite=${code}` : "";

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on JagX", text: `Use my code ${code} on JagX and we both win.`, url: inviteUrl });
      } catch {}
    } else copy(inviteUrl);
  };

  const claim = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("claim_affiliate_balance" as any);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const res: any = data;
    if (!res?.ok) { toast.error(res?.error || "Could not claim"); return; }
    toast.success(`+${res.credited} JagX added to your wallet 🪙`);
    load();
  };

  const redeemCode = async () => {
    if (!redeem.trim()) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("redeem_invite_code" as any, { _code: redeem.trim() });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const res: any = data;
    if (!res?.ok) { toast.error(res?.error || "Could not redeem"); return; }
    toast.success("Code redeemed! Your inviter has been notified.");
    setRedeem("");
    load();
  };

  const locked = referrals.filter(r => r.status === "locked").reduce((s, r) => s + (r.bonus_jagx || 0), 0);
  const withdrawable = referrals.filter(r => r.status === "withdrawable").reduce((s, r) => s + (r.bonus_jagx || 0), 0);
  const claimed = referrals.filter(r => r.status === "claimed").reduce((s, r) => s + (r.bonus_jagx || 0), 0);

  return (
    <div className="min-h-screen pb-32 bg-background text-foreground">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="text-base font-semibold">Affiliate</h1>
        </div>
      </header>

      <div className="px-4 py-6 space-y-5">
        {/* Invite code card */}
        <div className="rounded-2xl gold-gradient p-5 text-primary-foreground shadow-lg">
          <p className="text-[10px] uppercase tracking-widest opacity-80">Your invite code</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-3xl font-display tracking-widest">{code || "…"}</span>
            <div className="flex gap-2">
              <button onClick={() => copy(code)} className="p-2 rounded-full bg-white/20"><Copy className="size-4" /></button>
              <button onClick={share} className="p-2 rounded-full bg-white/20"><Share2 className="size-4" /></button>
            </div>
          </div>
          <p className="text-[11px] opacity-90 mt-3">Each friend who joins with your code earns you <b>50 JagX</b>.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<Users className="size-4" />} label="Invited" value={referrals.length} />
          <Stat icon={<Lock className="size-4" />} label="Locked" value={locked} />
          <Stat icon={<Coins className="size-4" />} label="Ready" value={withdrawable} />
        </div>

        {/* Claim */}
        <div className="rounded-2xl bg-surface border border-border/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold">Claim earnings</p>
              <p className="text-[11px] text-muted-foreground">Buy JagX coins once to unlock withdrawals.</p>
            </div>
            <Coins className="size-6 text-gold" />
          </div>
          <button onClick={claim} disabled={loading || withdrawable === 0}
            className="w-full py-3 rounded-xl gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-widest disabled:opacity-50">
            {withdrawable > 0 ? `Claim ${withdrawable} JagX → Wallet` : "Nothing to claim yet"}
          </button>
          {claimed > 0 && <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1"><CheckCircle2 className="size-3 text-green-500" /> {claimed} JagX already claimed</p>}
        </div>

        {/* Redeem someone else's code */}
        {!hasOwnRedemption && (
          <div className="rounded-2xl bg-surface border border-border/30 p-4">
            <p className="text-sm font-bold mb-1">Got an invite code?</p>
            <p className="text-[11px] text-muted-foreground mb-3">Enter it once — gives 50 JagX to your inviter.</p>
            <div className="flex gap-2">
              <input value={redeem} onChange={e => setRedeem(e.target.value.toUpperCase())} placeholder="ABCD1234"
                className="flex-1 px-3 py-2.5 rounded-xl bg-background border border-border text-sm uppercase tracking-widest" />
              <button onClick={redeemCode} disabled={loading || !redeem}
                className="px-4 py-2.5 rounded-xl gold-gradient text-primary-foreground text-xs font-bold uppercase">
                Redeem
              </button>
            </div>
          </div>
        )}

        {/* Referral list */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Recent invites</h3>
          {referrals.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No invites yet. Share your code!</p>}
          <div className="space-y-2">
            {referrals.map(r => (
              <div key={r.id} className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border/30">
                <div>
                  <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
                  <p className="text-sm font-medium">+{r.bonus_jagx} JagX</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${r.status === "claimed" ? "bg-green-500/20 text-green-400" : r.status === "withdrawable" ? "bg-gold/20 text-gold" : "bg-muted text-muted-foreground"}`}>
                  {r.status === "claimed" ? "Claimed" : r.status === "withdrawable" ? "Ready" : "Locked"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

const Stat = ({ icon, label, value }: any) => (
  <div className="rounded-2xl bg-surface border border-border/30 p-3 text-center">
    <div className="text-gold flex justify-center mb-1">{icon}</div>
    <p className="text-lg font-bold">{value}</p>
    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
  </div>
);

export default AffiliatePage;
