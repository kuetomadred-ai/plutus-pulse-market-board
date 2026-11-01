export type CandleBasis = "BID" | "ASK" | "MID" | "UNKNOWN";

export type RiskBar = {
  openTime: string;
  high: number;
  low: number;
  isOpen: boolean;
};

export function parseRiskBars(
  payload: unknown,
  now = Date.now(),
): { bars: RiskBar[]; basis: CandleBasis } {
  if (!payload || typeof payload !== "object") {
    return { bars: [], basis: "UNKNOWN" };
  }
  const data = payload as Record<string, unknown>;
  const rawBasis = String(data.priceBasis ?? "").toUpperCase();
  const basis: CandleBasis =
    rawBasis === "BID" || rawBasis === "ASK" || rawBasis === "MID"
      ? rawBasis
      : "MID";
  const rawBars = Array.isArray(data.bars) ? data.bars : [];
  const bars = rawBars
    .flatMap((raw): RiskBar[] => {
      if (!raw || typeof raw !== "object") return [];
      const row = raw as Record<string, unknown>;
      const timestamp = Date.parse(String(row.openTime ?? ""));
      const high = Number(row.high);
      const low = Number(row.low);
      const isOpen = row.isOpen === true;
      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        low <= 0 ||
        high < low ||
        isOpen ||
        timestamp + 60_000 > now
      ) {
        return [];
      }
      return [{ openTime: new Date(timestamp).toISOString(), high, low, isOpen: false }];
    })
    .sort((a, b) => a.openTime.localeCompare(b.openTime))
    .slice(-1000);
  return { bars, basis };
}
