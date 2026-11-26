import type { CurrencyCode } from "./model";

export interface DailyPoint {
  day: string;
  totalTokens: number;
  codexTokens: number;
  workbuddyTokens: number;
  antigravityTokens: number;
  estimatedUsd: number;
}

export interface SourceSummary {
  source: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  unclassifiedTokens: number;
  totalTokens: number;
  estimatedUsd: number | null;
  isPartial: boolean;
}

export interface ModelSummary {
  source: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  unclassifiedTokens: number;
  totalTokens: number;
  estimatedUsd: number | null;
  isPartial: boolean;
}

export interface UsageReport {
  days: number | null;
  scannedFiles: number;
  updatedFiles: number;
  totalTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  unclassifiedTokens: number;
  estimatedUsd: number;
  hasUnpriced: boolean;
  hasPartial: boolean;
  daily: DailyPoint[];
  bySource: SourceSummary[];
  byModel: ModelSummary[];
  generatedAt: number;
}

/** Format token counts in compact Chinese units without losing precision on small values. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)} 亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1)} 万`;
  return n.toLocaleString("zh-CN");
}

/** Format an estimated USD amount in the chosen currency. */
export function formatCost(
  usd: number | null,
  currency: CurrencyCode,
  usdToCny: number,
): string {
  if (usd == null || !Number.isFinite(usd)) return "未定价";
  const amount = currency === "CNY" ? usd * usdToCny : usd;
  const symbol = currency === "CNY" ? "¥" : "$";
  if (amount > 0 && amount < 0.01) return `${symbol}<0.01`;
  return `${symbol}${amount.toFixed(2)}`;
}

/** Compute cache hit ratio across measured prompt tokens (input + cacheRead). */
export function cacheHitRate(
  inputTokens: number,
  cacheReadTokens: number,
): number | null {
  const denom = inputTokens + cacheReadTokens;
  if (denom <= 0) return null;
  return (cacheReadTokens / denom) * 100;
}

/** Human-readable provider label for local usage tables. */
export function usageSourceName(source: string): string {
  if (source === "codex") return "Codex";
  if (source === "workbuddy") return "WorkBuddy";
  if (source === "antigravity") return "Antigravity";
  return source;
}

/** Isolated sample report for browser demo previews only. */
export function demoUsageReport(days: number | null): UsageReport {
  const today = new Date();
  const daily: DailyPoint[] = [];
  const count = Math.min(days ?? 14, 14);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    const day = d.toISOString().slice(0, 10);
    const codex = 120_000 + ((i * 53_000) % 240_000);
    const wb = 45_000 + ((i * 29_000) % 110_000);
    const ag = 60_000 + ((i * 41_000) % 160_000);
    daily.push({
      day,
      totalTokens: codex + wb + ag,
      codexTokens: codex,
      workbuddyTokens: wb,
      antigravityTokens: ag,
      estimatedUsd: Number(((codex + wb + ag) / 1_000_000 * 1.4).toFixed(2)),
    });
  }
  const total = daily.reduce((s, d) => s + d.totalTokens, 0);
  const usd = daily.reduce((s, d) => s + d.estimatedUsd, 0);
  return {
    days,
    scannedFiles: 18,
    updatedFiles: 2,
    totalTokens: total,
    inputTokens: Math.round(total * 0.22),
    cacheReadTokens: Math.round(total * 0.68),
    cacheWriteTokens: 0,
    outputTokens: Math.round(total * 0.1),
    unclassifiedTokens: 0,
    estimatedUsd: usd,
    hasUnpriced: false,
    hasPartial: true,
    daily,
    bySource: [
      {
        source: "codex",
        inputTokens: Math.round(total * 0.11),
        cacheReadTokens: Math.round(total * 0.36),
        cacheWriteTokens: 0,
        outputTokens: Math.round(total * 0.05),
        unclassifiedTokens: 0,
        totalTokens: Math.round(total * 0.52),
        estimatedUsd: usd * 0.55,
        isPartial: false,
      },
      {
        source: "antigravity",
        inputTokens: Math.round(total * 0.07),
        cacheReadTokens: Math.round(total * 0.21),
        cacheWriteTokens: 0,
        outputTokens: Math.round(total * 0.03),
        unclassifiedTokens: 0,
        totalTokens: Math.round(total * 0.31),
        estimatedUsd: usd * 0.3,
        isPartial: true,
      },
      {
        source: "workbuddy",
        inputTokens: Math.round(total * 0.04),
        cacheReadTokens: Math.round(total * 0.11),
        cacheWriteTokens: 0,
        outputTokens: Math.round(total * 0.02),
        unclassifiedTokens: 0,
        totalTokens: Math.round(total * 0.17),
        estimatedUsd: usd * 0.15,
        isPartial: false,
      },
    ],
    byModel: [
      {
        source: "codex",
        model: "gpt-5.2-codex",
        inputTokens: Math.round(total * 0.11),
        cacheReadTokens: Math.round(total * 0.36),
        cacheWriteTokens: 0,
        outputTokens: Math.round(total * 0.05),
        unclassifiedTokens: 0,
        totalTokens: Math.round(total * 0.52),
        estimatedUsd: usd * 0.55,
        isPartial: false,
      },
      {
        source: "antigravity",
        model: "gemini-3.5-flash-high",
        inputTokens: Math.round(total * 0.07),
        cacheReadTokens: Math.round(total * 0.21),
        cacheWriteTokens: 0,
        outputTokens: Math.round(total * 0.03),
        unclassifiedTokens: 0,
        totalTokens: Math.round(total * 0.31),
        estimatedUsd: usd * 0.3,
        isPartial: true,
      },
    ],
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
