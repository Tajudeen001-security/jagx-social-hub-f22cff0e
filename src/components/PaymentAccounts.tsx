import { useState } from "react";
import { Copy, Building2, Globe2, Wallet } from "lucide-react";
import { toast } from "sonner";

type Account = {
  id: string;
  label: string;
  currency: string;
  icon: "bank" | "crypto";
  fields: Array<{ k: string; v: string; mono?: boolean }>;
};

const ACCOUNTS: Account[] = [
  {
    id: "usd",
    label: "USD (US Bank)",
    currency: "USD",
    icon: "bank",
    fields: [
      { k: "Account holder", v: "Tajudeen Olajide Gbadamosi" },
      { k: "Bank name", v: "Lead" },
      { k: "Account number", v: "214893923320", mono: true },
      { k: "ACH routing", v: "101019644", mono: true },
      { k: "Wire routing", v: "101019644", mono: true },
      { k: "Account type", v: "Checking" },
      { k: "Country", v: "US" },
      { k: "Bank address", v: "1801 Main St., Kansas City, MO 64108" },
    ],
  },
  {
    id: "gbp",
    label: "GBP (UK Bank)",
    currency: "GBP",
    icon: "bank",
    fields: [
      { k: "Account holder", v: "Tajudeen Olajide Gbadamosi" },
      { k: "Bank name", v: "Clear Junction Limited" },
      { k: "Account number", v: "42915006", mono: true },
      { k: "Sort code", v: "04-13-07", mono: true },
      { k: "SWIFT / BIC", v: "CLJUGB21XXX", mono: true },
      { k: "IBAN", v: "GB77CLJU04130742915006", mono: true },
      { k: "Bank address", v: "4th Floor Imperial House, 15 Kingsway, London, WC2B 6UN" },
    ],
  },
  {
    id: "eur",
    label: "EUR (SEPA)",
    currency: "EUR",
    icon: "bank",
    fields: [
      { k: "Account holder", v: "Tajudeen Olajide Gbadamosi" },
      { k: "Bank name", v: "Clear Junction Limited" },
      { k: "Account number", v: "42915006", mono: true },
      { k: "Sort code", v: "04-13-07", mono: true },
      { k: "SWIFT / BIC", v: "CLJUGB21XXX", mono: true },
      { k: "IBAN", v: "GB77CLJU04130742915006", mono: true },
      { k: "Country", v: "GB" },
      { k: "Bank address", v: "4th Floor Imperial House, 15 Kingsway, London, WC2B 6UN" },
    ],
  },
  {
    id: "usdc-bep20",
    label: "USDC (BEP20)",
    currency: "USDC",
    icon: "crypto",
    fields: [
      { k: "Account holder", v: "Tajudeen Olajide Gbadamosi" },
      { k: "Network", v: "BEP20 (BNB Smart Chain)" },
      { k: "Wallet address", v: "0x4AAd8C9bb6d83AD67C784dB54F9529F9ADc540aE", mono: true },
    ],
  },
  {
    id: "usdt-bep20",
    label: "USDT (BEP20)",
    currency: "USDT",
    icon: "crypto",
    fields: [
      { k: "Account holder", v: "Tajudeen Olajide Gbadamosi" },
      { k: "Network", v: "BEP20 (BNB Smart Chain)" },
      { k: "Wallet address", v: "0x4AAd8C9bb6d83AD67C784dB54F9529F9ADc540aE", mono: true },
    ],
  },
  {
    id: "usdt-trc20",
    label: "USDT (TRC20)",
    currency: "USDT",
    icon: "crypto",
    fields: [
      { k: "Account holder", v: "Tajudeen Olajide Gbadamosi" },
      { k: "Network", v: "TRC20 (TRON)" },
      { k: "Wallet address", v: "THZTf29kwrLgv3ydwqbuZbbNPcWvw4JVn1", mono: true },
    ],
  },
];

const PaymentAccounts = ({ note }: { note?: string }) => {
  const [active, setActive] = useState<string>(ACCOUNTS[0].id);
  const acc = ACCOUNTS.find(a => a.id === active)!;
  const copy = async (v: string) => {
    try { await navigator.clipboard.writeText(v); toast.success("Copied"); }
    catch { toast.error("Copy failed"); }
  };
  return (
    <div className="rounded-2xl bg-surface border border-border overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <Globe2 className="size-4 text-gold" />
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Pay to any account</p>
      </div>
      <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-none">
        {ACCOUNTS.map(a => (
          <button key={a.id} onClick={() => setActive(a.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border transition ${
              active === a.id
                ? "bg-primary/15 text-gold border-primary/60"
                : "bg-background text-muted-foreground border-border"
            }`}>
            {a.icon === "bank" ? <Building2 className="size-3" /> : <Wallet className="size-3" />}
            {a.label}
          </button>
        ))}
      </div>
      <div className="px-3 pb-3 space-y-1.5">
        {acc.fields.map(f => (
          <button key={f.k} onClick={() => copy(f.v)}
            className="w-full flex items-start justify-between gap-2 py-2 px-3 rounded-lg bg-background hover:bg-background/70 text-left">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.k}</p>
              <p className={`text-sm text-champagne break-all ${f.mono ? "font-mono" : ""}`}>{f.v}</p>
            </div>
            <Copy className="size-3.5 text-muted-foreground shrink-0 mt-1" />
          </button>
        ))}
        {note && <p className="text-[11px] text-muted-foreground italic pt-1">{note}</p>}
      </div>
    </div>
  );
};

export default PaymentAccounts;