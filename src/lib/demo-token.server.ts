import crypto from "node:crypto";

const TOKEN_PREFIX = "plutus_demo_";

function secret(): string {
  const value = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["LOVABLE_CRON_SECRET"];
  if (!value) throw new Error("Demo token signing secret is not configured");
  return value;
}

export interface DemoPayload {
  userId: string;
  deviceId: string;
  exp: number;
}

export function signDemoToken(userId: string, deviceId: string): string {
  const payload: DemoPayload = { userId, deviceId, exp: Date.now() + 30 * 86400 * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${TOKEN_PREFIX}${encoded}.${signature}`;
}

export function verifyDemoToken(token: string): DemoPayload | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [encoded, signature, extra] = token.slice(TOKEN_PREFIX.length).split(".");
  if (!encoded || !signature || extra) return null;
  let expected: Buffer;
  try {
    expected = crypto.createHmac("sha256", secret()).update(encoded).digest();
    const provided = Buffer.from(signature, "base64url");
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected))
      return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<DemoPayload>;
    if (
      typeof payload.userId !== "string" ||
      !payload.userId ||
      typeof payload.deviceId !== "string" ||
      !payload.deviceId
    )
      return null;
    if (!Number.isSafeInteger(payload.exp) || (payload.exp as number) <= Date.now()) return null;
    return payload as DemoPayload;
  } catch {
    return null;
  }
}
