import { Plus, Minus, RefreshCw, Settings2, X, Pin } from "lucide-react";
import * as bridge from "../bridge";
import type { Preferences, Snapshot } from "../model";
/** Keep drag gestures and navigation controls together, independent from account operations. */
export function CardHeader({
  compact,
  snapshot,
  preferences,
  busy,
  settings,
  selection,
  redeeming,
  onRefresh,
  onSettings,
  onBack,
  onToggle,
}: {
  compact: boolean;
  snapshot: Snapshot | null;
  preferences: Preferences;
  busy: boolean;
  settings: boolean;
  selection: boolean;
  redeeming: boolean;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
  onBack: () => void;
  onToggle: () => void;
}) {
  const resizeTitle = preferences.compact ? "展开卡片" : "收起卡片";
  return (
    <header
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button,input")) bridge.drag();
      }}
    >
      {compact ? (
        /* Mini bar identity row: mark, account and plan share one line. */
        <>
          <span className="brand-mark mini-mark">C</span>
          <div className="mini-ident">
            <span className="email" title={snapshot?.account.email ?? ""}>
              {snapshot?.account.email ??
                (busy ? "正在读取账号…" : "等待账号信息")}
            </span>
          </div>
          <span className="badge">{snapshot?.account.planType ?? "Codex"}</span>
        </>
      ) : (
        <div className="brand">
          <span className="brand-mark">C</span>
          <span>Codex</span>
          {preferences.alwaysOnTop && <Pin size={12} className="pin-mark" />}
        </div>
      )}
      <div className="toolbar">
        {!compact && !settings && !selection && (
          <>
            <button
              className="icon-button"
              aria-label="刷新额度"
              title="刷新额度"
              onClick={() => void onRefresh()}
              disabled={busy}
            >
              <RefreshCw size={17} className={busy ? "loading" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label="偏好设置"
              title="偏好设置"
              onClick={() => onSettings()}
            >
              <Settings2 size={17} />
            </button>
          </>
        )}
        {settings || selection ? (
          <button
            className="icon-button glass-button"
            aria-label="返回卡片"
            disabled={redeeming}
            onClick={() => {
              onBack();
            }}
          >
            <X size={17} />
          </button>
        ) : (
          <button
            className="icon-button glass-button"
            aria-label={resizeTitle}
            title={resizeTitle}
            onClick={() => onToggle()}
          >
            {preferences.compact ? <Plus size={20} /> : <Minus size={20} />}
          </button>
        )}
      </div>
    </header>
  );
}
