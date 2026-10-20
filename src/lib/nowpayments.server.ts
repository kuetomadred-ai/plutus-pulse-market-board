// Server-only helpers for NOWPayments and the PLUTUS database.
export const PLOTOS_SB_URL = "https://jujjjvuspzfgrmeljljh.supabase.co";
export const PLOTOS_SB_KEY = "sb_publishable_X9YRYOHzL1v0OVXF_KRjiw_EHj7kTdV";

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((o, k) => {
        o[k] = sortDeep((v as Record<string, unknown>)[k]);
        return o;
      }, {});
  }
  return v;
}

/** NOWPayments IPN: HMAC-SHA512 over JSON with keys sorted, hex. */
export async function verifyIpn(body: unknown, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(sortDeep(body))),
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export function rest(path: string, init: RequestInit & { token?: string; admin?: boolean } = {}) {
  const service = process.env["PLOTOS_SERVICE_ROLE_KEY"];
  if (init.admin && !service) throw new Error("PLOTOS_SERVICE_ROLE_KEY missing");
  // sb_secret_ keys are opaque (not JWTs): send only as apikey, never as Bearer.
  const auth = init.admin ? (service!.startsWith("sb_secret_") ? undefined : service) : init.token;
  return fetch(`${PLOTOS_SB_URL}${path}`, {
    ...init,
    headers: {
      apikey: init.admin ? service! : PLOTOS_SB_KEY,
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}
