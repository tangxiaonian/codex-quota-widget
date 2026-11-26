import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import * as bridge from "../bridge";
import type { CurrencyCode, Preferences } from "../model";
import {
  cacheHitRate,
  formatCost,
  formatTokens,
  usageSourceName,
  type UsageReport,
} from "../usageTypes";
import { UsageChart } from "./UsageChart";

const SPAN_OPTIONS: { label: string; days: number | null }[] = [
  { label: "今日", days: 1 },
  { label: "近 7 天", days: 7 },
  { label: "近 30 天", days: 30 },
  { label: "全部", days: null },
];

/** Local-only Token usage analytics panel inside the dedicated dashboard window. */
export function UsageView({
  preferences,
  update,
}: {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => Promise<void>;
}) {
  const [days, setDays] = useState<number | null>(7);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (span: number | null) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await bridge.scanUsageReport(span));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  async function clearAndRescan() {
    setBusy(true);
    try {
      await bridge.clearUsageCache();
      await load(days);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
      setBusy(false);
    }
  }

  const currency: CurrencyCode = preferences.currency;
  const rate = preferences.usdToCny || 7.2;

  const filteredModels = (report?.byModel ?? []).filter(
    (m) => sourceFilter === "all" || m.source === sourceFilter,
  );
  const filteredSources = (report?.bySource ?? []).filter(
    (s) => sourceFilter === "all" || s.source === sourceFilter,
  );
  const totalTokens = filteredSources.reduce((s, x) => s + x.totalTokens, 0);
  const inputTokens = filteredSources.reduce((s, x) => s + x.inputTokens, 0);
  const cacheReadTokens = filteredSources.reduce(
    (s, x) => s + x.cacheReadTokens,
    0,
  );
  const estimatedUsd = filteredSources.reduce(
    (s, x) => s + (x.estimatedUsd ?? 0),
    0,
  );
  const hitRate = cacheHitRate(inputTokens, cacheReadTokens);
  const topModel = filteredModels[0]?.model ?? "—";

  return (
    <div className="usage-page">
      <div className="dash-toolbar">
        <div className="dash-pills" role="group" aria-label="统计时间范围">
          {SPAN_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={days === opt.days ? "active" : ""}
              onClick={() => setDays(opt.days)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="dash-toolbar-right">
          <div className="dash-pills" role="group" aria-label="筛选来源">
            {["all", "codex", "workbuddy", "antigravity"].map((src) => (
              <button
                key={src}
                type="button"
                className={sourceFilter === src ? "active" : ""}
                onClick={() => setSourceFilter(src)}
              >
                {src === "all" ? "全部" : usageSourceName(src)}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="dash-btn"
            onClick={() =>
              void update({ currency: currency === "CNY" ? "USD" : "CNY" })
            }
            title="切换估算币种"
          >
            {currency === "CNY" ? "¥ CNY" : "$ USD"}
          </button>

          <button
            type="button"
            className="dash-btn"
            disabled={busy}
            onClick={() => void load(days)}
            title="增量重扫本地会话记录"
          >
            <RefreshCw size={13} className={busy ? "loading" : ""} /> 刷新
          </button>

          <button
            type="button"
            className="dash-btn subtle"
            disabled={busy}
            onClick={() => void clearAndRescan()}
            title="清空本地统计缓存并全量重建"
          >
            <Trash2 size={13} /> 重建缓存
          </button>
        </div>
      </div>

      {error && <p className="dash-error">{error}</p>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <span>总 Token</span>
          <strong>{formatTokens(totalTokens)}</strong>
          <small>
            已索引 {report?.scannedFiles ?? 0} 个本地会话文件
            {report && report.updatedFiles > 0
              ? `（本次新增/更新 ${report.updatedFiles}）`
              : ""}
          </small>
        </div>
        <div className="kpi-card">
          <span>缓存命中率</span>
          <strong>{hitRate == null ? "—" : `${hitRate.toFixed(1)}%`}</strong>
          <small>
            新输入 {formatTokens(inputTokens)} · 缓存读{" "}
            {formatTokens(cacheReadTokens)}
          </small>
        </div>
        <div className="kpi-card">
          <span>估算 API 等值</span>
          <strong>{formatCost(estimatedUsd, currency, rate)}</strong>
          <small>
            按公开单价估算
            {report?.hasUnpriced ? " · 含未定价项" : ""}
          </small>
        </div>
        <div className="kpi-card">
          <span>主力模型</span>
          <strong className="kpi-model" title={topModel}>
            {topModel}
          </strong>
          <small>
            {report?.hasPartial
              ? "含部分统计来源（如 Antigravity）"
              : "统计完整"}
          </small>
        </div>
      </div>

      {report && (
        <UsageChart
          daily={report.daily}
          sourceFilter={sourceFilter}
          currency={currency}
          usdToCny={rate}
        />
      )}

      <div className="usage-table-card">
        <h3>按模型与来源明细</h3>
        {filteredModels.length === 0 ? (
          <p className="dash-empty">暂无可显示的模型统计记录</p>
        ) : (
          <table className="usage-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>模型</th>
                <th className="num">新输入</th>
                <th className="num">缓存读</th>
                <th className="num">输出</th>
                <th className="num">总 Token</th>
                <th className="num">估算费用</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((row) => (
                <tr key={`${row.source}:${row.model}`}>
                  <td>
                    <span className={`src-tag ${row.source}`}>
                      {usageSourceName(row.source)}
                    </span>
                  </td>
                  <td className="model-cell" title={row.model}>
                    {row.model}
                    {row.isPartial && <em className="partial-tag">部分</em>}
                  </td>
                  <td className="num">{formatTokens(row.inputTokens)}</td>
                  <td className="num">{formatTokens(row.cacheReadTokens)}</td>
                  <td className="num">{formatTokens(row.outputTokens)}</td>
                  <td className="num strong">
                    {formatTokens(row.totalTokens)}
                  </td>
                  <td className="num">
                    {formatCost(row.estimatedUsd, currency, rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="dash-footnote">
        仅在本地只读解析 Codex（~/.codex）、WorkBuddy（~/.workbuddy）与
        Antigravity（~/.gemini）的已有会话记录，绝不上传任何数据，不落库对话内容。
      </p>
    </div>
  );
}
