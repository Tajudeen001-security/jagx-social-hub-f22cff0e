import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Coins, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";

const InvestProjectPage = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [amount, setAmount] = useState<number>(0);
  const [form, setForm] = useState({
    full_name: "", gov_id: "", email: "", phone: "", address: "", country: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data } = await (supabase as any).from("investment_projects").select("*").eq("slug", slug).maybeSingle();
      setProject(data);
    })();
  }, [slug]);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      setProfile(data);
      if (data) setForm(f => ({
        ...f,
        full_name: data.display_name || `${data.first_name || ""} ${data.last_name || ""}`.trim(),
        email: user.email || "",
        phone: (data as any).phone || "",
        address: (data as any).delivery_address || "",
      }));
    });
  }, [user]);

  const shares = project ? Math.floor(amount / project.price_per_share_jagx) : 0;
  const equity = project ? (shares / project.total_shares) * project.equity_total_pct : 0;
  const balance = profile?.coin_balance ?? 0;

  // signature canvas
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    const ctx = c.getContext("2d")!; ctx.beginPath(); ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    const ctx = c.getContext("2d")!; ctx.lineWidth = 2; ctx.strokeStyle = "#c9a227";
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top); ctx.stroke();
  };
  const endDraw = () => { drawingRef.current = false; };
  const clearSig = () => { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); };

  const submit = async () => {
    if (!project || !user) return;
    if (shares <= 0) return toast.error("Amount too small for one share");
    if (amount > balance) return toast.error("Insufficient JagX balance");
    if (Object.values(form).some(v => !v.trim())) return toast.error("Fill in all credentials");
    const sigData = canvasRef.current!.toDataURL("image/png");
    if (!sigData || sigData.length < 2000) return toast.error("Please draw your signature");
    setSubmitting(true);
    const { error } = await (supabase as any).rpc("submit_investment_application", {
      _project_id: project.id, _amount_jagx: amount,
      _full_name: form.full_name, _gov_id: form.gov_id, _email: form.email,
      _phone: form.phone, _address: form.address, _country: form.country,
      _signature_data_url: sigData,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Application submitted. Awaiting admin review.");
    navigate("/invest/mine");
  };

  if (!project) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)}><ArrowLeft className="size-5" /></button>
          <h1 className="font-display italic text-xl text-gold">{project.name}</h1>
        </div>
      </header>
      <div className="p-4 space-y-4">
        <div className="p-4 rounded-xl glass gold-glow space-y-1">
          <p className="text-sm text-champagne">{project.description}</p>
          <p className="text-xs text-muted-foreground">Price: <span className="text-gold font-bold">{project.price_per_share_jagx} JagX</span> / share · {project.available_shares.toLocaleString()} shares left</p>
          <p className="text-xs text-muted-foreground">Your balance: <span className="text-gold font-bold">{balance} JagX</span></p>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">JagX to invest</label>
          <input type="number" value={amount || ""} onChange={e => setAmount(Number(e.target.value))}
            className="w-full bg-background rounded-lg px-3 py-2 text-base text-champagne" />
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="p-2 rounded bg-background">Shares: <span className="text-gold font-bold">{shares}</span></div>
            <div className="p-2 rounded bg-background">Equity: <span className="text-gold font-bold">{equity.toFixed(5)}%</span></div>
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            Locked quote: {project.price_per_share_jagx} JagX/share. This price is
            snapshotted at submission — your certificate will match exactly, even if
            the project price changes before admin approval.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
          <h3 className="text-sm font-semibold text-champagne flex items-center gap-2"><ShieldCheck className="size-4 text-gold" />Investor credentials</h3>
          {(["full_name","gov_id","email","phone","address","country"] as const).map(k => (
            <input key={k} placeholder={k.replace("_"," ").toUpperCase()} value={(form as any)[k]}
              onChange={e => setForm({ ...form, [k]: e.target.value })}
              className="w-full bg-background rounded-lg px-3 py-2 text-sm text-champagne" />
          ))}
        </div>

        <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-champagne">Signature</h3>
            <button onClick={clearSig} className="text-xs text-muted-foreground">Clear</button>
          </div>
          <canvas ref={canvasRef} width={500} height={160}
            onPointerDown={startDraw} onPointerMove={moveDraw} onPointerUp={endDraw} onPointerLeave={endDraw}
            className="w-full h-40 bg-background rounded-lg touch-none" />
        </div>

        <button disabled={submitting} onClick={submit}
          className="w-full py-3 rounded-xl gold-gradient text-primary-foreground text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-2">
          <Coins className="size-4" /> {submitting ? "Submitting…" : `Invest ${amount || 0} JagX`}
        </button>
      </div>
      <BottomNav />
    </div>
  );
};
export default InvestProjectPage;