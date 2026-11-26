import { useState } from "react";
import type { CurrencyCode } from "../model";
import { formatCost, formatTokens, type DailyPoint } from "../usageTypes";

/** Lightweight zero-dependency stacked SVG bar chart for daily token usage. */
export function UsageChart({
  daily,
  sourceFilter,
  currency,
  usdToCny,
}: {
  daily: DailyPoint[];
  sourceFilter: string;
  currency: CurrencyCode;
  usdToCny: number;
}) {
  const [hovered, setHovered] = useState<DailyPoint | null>(null);
  if (daily.length === 0) {
    return <p className="dash-empty">所选时间范围内暂无本地 Token 记录</p>;
  }

  const points = daily.slice(-31);
  const valueOf = (p: DailyPoint) => {
    if (sourceFilter === "codex") return p.codexTokens;
    if (sourceFilter === "workbuddy") return p.workbuddyTokens;
    if (sourceFilter === "antigravity") return p.antigravityTokens;
    return p.totalTokens;
  };
  const maxVal = Math.max(1, ...points.map(valueOf));
  const chartH = 148;
  const chartW = Math.max(480, points.length * 22);
  const barW = Math.min(20, Math.max(8, Math.floor((chartW - 24) / points.length) - 6));
  const step = (chartW - 24) / points.length;

  return (
    <div className="usage-chart-wrap">
      <div className="usage-chart-head">
        <h3>每日 Token 趋势</h3>
        <div className="usage-legend">
          {(sourceFilter === "all" || sourceFilter === "codex") && (
            <span>
              <i className="leg codex" /> Codex
            </span>
          )}
          {(sourceFilter === "all" || sourceFilter === "workbuddy") && (
            <span>
              <i className="leg workbuddy" /> WorkBuddy
            </span>
          )}
          {(sourceFilter === "all" || sourceFilter === "antigravity") && (
            <span>
              <i className="leg antigravity" /> Antigravity
            </span>
          )}
        </div>
      </div>

      <div className="usage-chart-canvas">
        <svg
          viewBox={`0 0 ${chartW} ${chartH + 24}`}
          width="100%"
          height="176"
          role="img"
          aria-label="每日 Token 使用柱状图"
        >
          {[0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = Math.round(chartH * (1 - ratio)) + 4;
            return (
              <line
                key={ratio}
                x1="10"
                x2={chartW - 10}
                y1={y}
                y2={y}
                className="chart-grid"
              />
            );
          })}
          {points.map((point, idx) => {
            const x = 12 + idx * step + (step - barW) / 2;
            const total = valueOf(point);
            const segments =
              sourceFilter === "all"
                ? [
                    { key: "codex", val: point.codexTokens },
                    { key: "workbuddy", val: point.workbuddyTokens },
                    { key: "antigravity", val: point.antigravityTokens },
                  ]
                : [{ key: sourceFilter, val: total }];

            let cursorY = chartH + 4;
            const showLabel =
              points.length <= 10 ||
              idx === 0 ||
              idx === points.length - 1 ||
              idx % Math.ceil(points.length / 7) === 0;

            return (
              <g
                key={point.day}
                onMouseEnter={() => setHovered(point)}
                onMouseLeave={() => setHovered(null)}
                className="chart-col"
              >
                <rect
                  x={x - 3}
                  y={4}
                  width={barW + 6}
                  height={chartH}
                  fill="transparent"
                />
                {segments.map((seg) => {
                  if (seg.val <= 0) return null;
                  const h = Math.max(2, Math.round((seg.val / maxVal) * (chartH - 6)));
                  cursorY -= h;
                  return (
                    <rect
                      key={seg.key}
                      x={x}
                      y={cursorY}
                      width={barW}
                      height={h}
                      rx="2"
                      className={`chart-bar ${seg.key}`}
                    />
                  );
                })}
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={chartH + 19}
                    textAnchor="middle"
                    className="chart-axis"
                  >
                    {point.day.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="usage-chart-tip">
        {hovered ? (
          <span>
            <strong>{hovered.day}</strong> · 总计 {formatTokens(hovered.totalTokens)}
            {" · "}Codex {formatTokens(hovered.codexTokens)} / WorkBuddy{" "}
            {formatTokens(hovered.workbuddyTokens)} / Antigravity{" "}
            {formatTokens(hovered.antigravityTokens)}
            {" · "}估算 {formatCost(hovered.estimatedUsd, currency, usdToCny)}
          </span>
        ) : (
          <span>悬停柱状图查看单日明细</span>
        )}
      </div>
    </div>
  );
}
