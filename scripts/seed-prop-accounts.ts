// Seeds the 10 simulated 2-step evaluation accounts (run: bun run scripts/seed-prop-accounts.ts)
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const A: [string, string, string][] = [
  ["زينب أمين", "zainab.amin33", "Pl391QROck#7"],
  ["هناء صادق", "hanaa.sadiq32", "PllLnLXoe5#7"],
  ["مروة محمد", "marwa.mohammed77", "Pl3NBNSGdc#7"],
  ["سناء جاسم", "sanaa.jasim27", "PlLRVS6QNT#7"],
  ["استبرق محمد", "istabraq.mohammed17", "PlRERVqVNH#7"],
  ["وداد صادق", "wedad.sadiq73", "Pl46yGsxqs#7"],
  ["عبير محمود", "abeer.mahmoud71", "PlvStUn1I7#7"],
  ["ريام اسماعيل", "riyam.ismail76", "PlCfvEQsrC#7"],
  ["هدى صادق", "huda.sadiq47", "PlD0npHFcy#7"],
  ["حنان حاتم", "hanan.hatim67", "PlBgnhNdhK#7"],
];

const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
for (let i = 0; i < A.length; i++) {
  const [name, local, password] = A[i];
  const email = `${local}@plutustrade.app`;
  let uid = list?.users.find((u) => u.email === email)?.id;
  if (!uid) {
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: name },
    });
    if (error) throw error;
    uid = data.user!.id;
  }
  const { error } = await db.from("pf_engine_accounts").upsert({
    id: String(50001 + i), user_id: uid, initial_balance: 10000, balance: 10000,
    leverage: 100, program: "PROP", phase: 1, profit_target_pct: 8, daily_loss_pct: 5,
    max_dd_pct: 10, day_start_balance: 10000, min_equity: 10000,
    status: "ACTIVE", challenge_status: "ACTIVE",
  });
  if (error) throw error;
  console.log("ok", 50001 + i, email);
}
