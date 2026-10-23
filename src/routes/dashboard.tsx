import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "لوحة التقييم | PLUTUS" },
      { name: "description", content: "تقدم تقييم المرحلتين، الأرباح والخسائر وحدود المخاطر لحسابك." },
      { property: "og:title", content: "لوحة التقييم | PLUTUS" },
      { property: "og:description", content: "تقدم التقييم والأرباح والخسائر وحدود المخاطر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Acc = any;
const $ = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Bar({ v, tone }: { v: number; tone: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  return (
    <form
      className="mx-auto mt-24 max-w-sm space-y-3 rounded-xl border bg-card p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) setErr("بيانات الدخول غير صحيحة");
      }}
    >
      <h1 className="text-xl font-bold">دخول لوحة التقييم</h1>
      <input className="w-full rounded border bg-background p-2" placeholder="البريد" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="w-full rounded border bg-background p-2" type="password" placeholder="كلمة المرور" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <button className="w-full rounded bg-primary p-2 font-bold text-primary-foreground">دخول</button>
    </form>
  );
}

function Dashboard() {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [acc, setAcc] = useState<Acc | null>(null);
  const [open, setOpen] = useState<Acc[]>([]);
  const [hist, setHist] = useState<Acc[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUid(s?.user?.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!uid) return;
    const load = async () => {
      const a = await supabase.from("pf_engine_accounts").select("*").eq("user_id", uid).limit(1).maybeSingle();
      setAcc(a.data);
      if (!a.data) return;
      const [p, h] = await Promise.all([
        supabase.from("pf_engine_positions").select("*").eq("account_id", a.data.id).eq("status", "OPEN"),
        supabase.from("pf_engine_trades_history").select("*").eq("account_id", a.data.id).order("closed_at", { ascending: false }).limit(20),
      ]);
      setOpen(p.data ?? []);
      setHist(h.data ?? []);
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [uid]);

  if (uid === undefined) return <div className="p-8 text-center">...</div>;
  if (!uid) return <div dir="rtl" className="min-h-screen bg-background p-4 text-foreground"><Login /></div>;
  if (!acc) return <div dir="rtl" className="p-8 text-center">لا يوجد حساب تقييم مرتبط.</div>;

  const init = Number(acc.initial_balance);
  const bal = Number(acc.balance);
  const pnl = bal - init;
  const target = (init * Number(acc.profit_target_pct ?? 8)) / 100;
  const dayStart = Number(acc.day_start_balance ?? init);
  const dailyLimit = (dayStart * Number(acc.daily_loss_pct ?? 5)) / 100;
  const dayLoss = Math.max(0, dayStart - bal);
  const maxDD = (init * Number(acc.max_dd_pct ?? 10)) / 100;
  const ddUsed = Math.max(0, init - Math.min(bal, Number(acc.min_equity ?? bal)));
  const days = new Set(hist.map((h) => String(h.closed_at).slice(0, 10))).size;

  const cards = [
    ["الرصيد", $(bal)],
    ["صافي الربح/الخسارة", $(pnl)],
    ["المتبقي للهدف", $(Math.max(0, target - pnl))],
    ["أيام التداول", String(days)],
  ];
  const rules = [
    ["هدف الربح", `${acc.profit_target_pct}%`, pnl >= target ? "محقق" : "جارٍ"],
    ["حد الخسارة اليومي", `${acc.daily_loss_pct}%`, dayLoss >= dailyLimit ? "متجاوز" : "آمن"],
    ["أقصى تراجع كلي", `${acc.max_dd_pct}%`, ddUsed >= maxDD ? "متجاوز" : "آمن"],
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-background p-4 text-foreground md:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">تقييم المرحلتين — المرحلة {acc.phase}</h1>
            <p className="text-sm text-muted-foreground">حساب #{acc.id} · رافعة 1:{Number(acc.leverage)} · مراقبة 24/7</p>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full border px-3 py-1 text-sm font-bold">{acc.challenge_status}</span>
            <button className="rounded border px-3 py-1 text-sm" onClick={() => supabase.auth.signOut()}>خروج</button>
          </div>
        </header>
        {acc.fail_reason && <p className="rounded border border-destructive p-3 text-destructive">سبب الإيقاف: {acc.fail_reason}</p>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="mt-1 text-lg font-bold">{v}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["هدف الربح", pnl, target, "bg-primary"],
            ["الخسارة اليومية", dayLoss, dailyLimit, "bg-destructive"],
            ["التراجع الكلي", ddUsed, maxDD, "bg-destructive"],
          ].map(([k, used, lim, tone]) => (
            <div key={k as string} className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex justify-between text-sm"><span>{k as string}</span><span>{$(Math.max(0, used as number))} / {$(lim as number)}</span></div>
              <Bar v={((used as number) / (lim as number)) * 100} tone={tone as string} />
            </div>
          ))}
        </div>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-bold">أهداف التقييم</h2>
          {rules.map(([k, v, s]) => (
            <div key={k} className="flex justify-between border-b py-2 text-sm last:border-0">
              <span>{k}</span><span>{v}</span><span className="font-bold">{s}</span>
            </div>
          ))}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-bold">الصفقات المفتوحة ({open.length})</h2>
          {open.map((p) => (
            <div key={p.id} className="flex justify-between border-b py-1 text-sm">
              <span>{p.symbol}</span><span>{p.side}</span><span>{p.lots}</span><span>{p.entry_price}</span>
            </div>
          ))}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-bold">الصفقات المغلقة</h2>
          {hist.map((h) => (
            <div key={h.id} className="flex justify-between border-b py-1 text-sm">
              <span>{h.symbol}</span><span>{h.close_reason}</span>
              <span className={Number(h.realized_pnl) >= 0 ? "text-primary" : "text-destructive"}>{$(Number(h.realized_pnl))}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
