import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Moon, Sun, Bell, Shield, Database, LogOut, Trash2, Gift, Smartphone, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";

type Theme = "dark" | "light" | "system";

const applyTheme = (t: Theme) => {
  const root = document.documentElement;
  const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
};

export const initTheme = () => {
  const t = (localStorage.getItem("jagx_theme") as Theme) || "dark";
  applyTheme(t);
};

const SettingsPage = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [theme, setTheme] = useState<Theme>(((typeof localStorage !== "undefined" && localStorage.getItem("jagx_theme")) as Theme) || "dark");
  const [pushEnabled, setPushEnabled] = useState<boolean>(typeof Notification !== "undefined" && Notification.permission === "granted");
  const [privateAccount, setPrivateAccount] = useState(false);
  const [showActive, setShowActive] = useState(true);
  const [storageEstimate, setStorageEstimate] = useState<string>("—");

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("is_private, show_active_status").eq("user_id", user.id).maybeSingle().then(({ data }: any) => {
      if (data) {
        setPrivateAccount(!!data.is_private);
        setShowActive(data.show_active_status !== false);
      }
    });
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then(e => {
        if (e.usage) setStorageEstimate(`${(e.usage / 1024 / 1024).toFixed(1)} MB`);
      });
    }
  }, [user]);

  const changeTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem("jagx_theme", t);
    applyTheme(t);
    toast.success(`Theme: ${t}`);
  };

  const togglePush = async () => {
    if (pushEnabled) {
      toast.info("To disable push, revoke permission in your browser settings.");
      return;
    }
    if (typeof Notification === "undefined") { toast.error("Notifications not supported"); return; }
    const perm = await Notification.requestPermission();
    setPushEnabled(perm === "granted");
    if (perm === "granted") toast.success("Push notifications enabled");
  };

  const togglePrivacy = async (key: "is_private" | "show_active_status", val: boolean) => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ [key]: val } as any).eq("user_id", user.id);
    if (error) { toast.error(error.message); return; }
    if (key === "is_private") setPrivateAccount(val);
    else setShowActive(val);
    toast.success("Saved");
  };

  const clearCache = async () => {
    try {
      sessionStorage.clear();
      const keep = ["jagx_theme", "supabase.auth.token"];
      Object.keys(localStorage).forEach(k => { if (!keep.includes(k) && !k.startsWith("sb-")) localStorage.removeItem(k); });
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      toast.success("Cache cleared");
      setStorageEstimate("0 MB");
    } catch (e: any) { toast.error(e?.message || "Could not clear"); }
  };

  const deleteAccount = async () => {
    if (!user) return;
    const confirm1 = prompt("Type DELETE to permanently remove your account:");
    if (confirm1 !== "DELETE") return;
    // Soft-delete via profile flag — server-side cleanup runs separately.
    await supabase.from("profiles").update({ is_deleted: true } as any).eq("user_id", user.id);
    await signOut();
    toast.success("Account scheduled for deletion");
    navigate("/auth");
  };

  return (
    <div className="min-h-screen pb-32 bg-background text-foreground">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft className="size-5" /></button>
          <h1 className="text-base font-semibold">Settings</h1>
        </div>
      </header>

      <div className="px-4 py-6 space-y-6">

        {/* Appearance */}
        <Section title="Appearance" icon={<Moon className="size-4" />}>
          <div className="grid grid-cols-3 gap-2">
            {(["dark","light","system"] as Theme[]).map(t => (
              <button key={t} onClick={() => changeTheme(t)}
                className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border ${theme === t ? "gold-gradient text-primary-foreground border-transparent" : "bg-surface border-border/30 text-muted-foreground"}`}>
                {t === "dark" ? <Moon className="size-4 inline mr-1" /> : t === "light" ? <Sun className="size-4 inline mr-1" /> : <Smartphone className="size-4 inline mr-1" />}
                {t}
              </button>
            ))}
          </div>
        </Section>

        {/* Notifications */}
        <Section title="Notifications" icon={<Bell className="size-4" />}>
          <Row label="Push notifications" desc={pushEnabled ? "Enabled" : "Disabled"}>
            <Toggle on={pushEnabled} onChange={togglePush} />
          </Row>
        </Section>

        {/* Privacy */}
        <Section title="Privacy" icon={<Shield className="size-4" />}>
          <Row label="Private account" desc="Only approved followers can see your posts">
            <Toggle on={privateAccount} onChange={(v) => togglePrivacy("is_private", v)} />
          </Row>
          <Row label="Show active status" desc="Let people see when you're online">
            <Toggle on={showActive} onChange={(v) => togglePrivacy("show_active_status", v)} />
          </Row>
          <button onClick={() => navigate("/privacy")} className="w-full text-left text-sm text-gold py-2">View Privacy Policy →</button>
        </Section>

        {/* Affiliate */}
        <Section title="Affiliate Program" icon={<Gift className="size-4" />}>
          <p className="text-xs text-muted-foreground mb-2">Invite friends, earn 50 JagX per signup.</p>
          <button onClick={() => navigate("/affiliate")} className="w-full py-2.5 rounded-xl gold-gradient text-primary-foreground text-xs font-bold uppercase tracking-widest">
            Open Affiliate Dashboard
          </button>
        </Section>

        {/* Storage */}
        <Section title="Storage & Data" icon={<Database className="size-4" />}>
          <Row label="App cache" desc={storageEstimate}>
            <button onClick={clearCache} className="px-3 py-1.5 rounded-lg bg-surface border border-border/30 text-xs">Clear</button>
          </Row>
        </Section>

        {/* Account */}
        <Section title="Account" icon={<Lock className="size-4" />}>
          <button onClick={() => navigate("/edit-profile")} className="w-full text-left text-sm py-2.5 border-b border-border/20">Edit profile</button>
          <button onClick={() => navigate("/coins")} className="w-full text-left text-sm py-2.5 border-b border-border/20">JagX Coins wallet</button>
          <button onClick={async () => { await signOut(); navigate("/auth"); }} className="w-full flex items-center gap-2 text-sm py-2.5 text-red-400 border-b border-border/20">
            <LogOut className="size-4" /> Sign out
          </button>
          <button onClick={deleteAccount} className="w-full flex items-center gap-2 text-sm py-2.5 text-red-500">
            <Trash2 className="size-4" /> Delete account
          </button>
        </Section>

        <p className="text-center text-[10px] text-muted-foreground">JagX Connect • Buddy 3.0</p>
      </div>

      <BottomNav />
    </div>
  );
};

const Section = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-2xl bg-surface border border-border/30 p-4 space-y-1">
    <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-gold font-bold mb-2">{icon}{title}</h2>
    {children}
  </section>
);

const Row = ({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between py-2.5">
    <div>
      <p className="text-sm font-medium">{label}</p>
      {desc && <p className="text-[11px] text-muted-foreground">{desc}</p>}
    </div>
    {children}
  </div>
);

const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button onClick={() => onChange(!on)} aria-pressed={on}
    className={`relative w-11 h-6 rounded-full transition-colors ${on ? "gold-gradient" : "bg-muted"}`}>
    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-md transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
  </button>
);

export default SettingsPage;
