import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Minus,
  Plus,
  RefreshCw,
  Settings2,
  X,
  Pin,
} from "lucide-react";
import { Gauge } from "./Gauge";
import { useWidget } from "./useWidget";
import {
  canUse,
  duration,
  expiryDate,
  localizedTitle,
  outcomeMessage,
  remaining,
  sortedCredits,
  type Credit,
  type QuotaWindow,
} from "./model";
import * as bridge from "./bridge";

type Selection = {
  credit: Credit;
  accountKey: string;
  email: string;
  attemptId: string;
};
/** The card owns presentation only; account access and redemption remain behind typed commands. */
export default function App() {
  const w = useWidget(),
    root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null),
    [redeeming, setRedeeming] = useState(false),
    [login, setLogin] = useState(false),
    [loginBusy, setLoginBusy] = useState(false);
  const [interval, setIntervalValue] = useState("5");
  const { snapshot, preferences, now } = w;
  const compact = preferences.compact && !w.settings && !selection;
  const mode = w.settings
    ? "settings"
    : selection
      ? "confirmation"
      : compact
        ? "compact"
        : "expanded";
  const lastMode = useRef<string | null>(null);
  // Mini bar default: glanceable quota without occupying desktop space.
  const sizes = useRef<Record<string, { width: number; height: number }>>({
    compact: { width: 360, height: 104 },
    expanded: { width: 368, height: 524 },
    settings: { width: 368, height: 474 },
    confirmation: { width: 368, height: 435 },
  });
  // Resize only when changing views. Refreshes must not undo the user's manual size.
  useEffect(() => {
    if (!bridge.native || !w.ready || lastMode.current === mode) return;
    if (lastMode.current)
      sizes.current[lastMode.current] = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    lastMode.current = mode;
    const size = sizes.current[mode];
    void bridge
      .resize(size.width, size.height)
      .catch((e) => w.setError(String(e)));
  }, [mode, w.ready]);
  useEffect(() => {
    setIntervalValue(String(preferences.refreshMinutes));
  }, [preferences.refreshMinutes]);
  // The mini bar is fixed-size: flip the native resizable mask with the mode,
  // otherwise macOS still allows frameless edge dragging even with hidden edges.
  useEffect(() => {
    if (!bridge.native || !w.ready) return;
    void bridge
      .setResizable(!compact)
      .catch((e) => w.setError(String(e)));
  }, [compact, w.ready]);
  // Drag-to-top parking: when a compact drag ends near the screen top, the native
  // layer parks the mini bar behind the menu bar and reveals it on cursor hover.
  useEffect(() => {
    if (!bridge.native || !w.ready) return;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    void bridge.onMove((_x, y) => {
      clearTimeout(timer);
      // Debounced: only the drag END position decides parking.
      timer = setTimeout(() => {
        const logicalY = y / (window.devicePixelRatio || 2);
        // Only on-screen drag-end positions park the bar; park/reveal animation
        // coordinates are ignored so the loop cannot re-trigger itself.
        if (compact && logicalY >= 0 && logicalY <= 60)
          void bridge.armTopHide().catch((e) => w.setError(String(e)));
        // Dragging the bar away from the top ends the auto-hide cycle entirely.
        else if (compact) void bridge.disarmTopHide().catch(() => {});
      }, 400);
    }).then((fn) => (unlisten = fn));
    return () => {
      clearTimeout(timer);
      unlisten?.();
      // Leaving the compact mode must guarantee the card can come back later.
      if (!compact) void bridge.disarmTopHide();
    };
  }, [compact, w.ready]);
  // One-shot catch-up: a restored window that already sits at the top parks by
  // itself, without waiting for another drag gesture. Runs once per compact
  // entry, never after a reveal, so it cannot restart the flicker loop.
  useEffect(() => {
    if (!bridge.native || !w.ready || !compact) return;
    const t = setTimeout(() => {
      void bridge.outerTopLogical().then((logicalY) => {
        if (logicalY != null && logicalY >= 0 && logicalY <= 60)
          void bridge.armTopHide().catch(() => {});
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [compact, w.ready]);
  useEffect(() => {
    if (w.settings)
      void bridge
        .loginStatus()
        .then(setLogin)
        .catch((e) => w.setError(String(e)));
  }, [w.settings]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !redeeming) {
        setSelection(null);
        w.setSettings(false);
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [redeeming, w.setSettings]);
  /** Capture the account and credit at selection time, not when a later render happens. */
  function choose(credit: Credit) {
    if (!snapshot || !w.fresh || w.busy) return;
    setSelection({
      credit,
      accountKey: snapshot.account.key,
      email: snapshot.account.email ?? "当前账号",
      attemptId: crypto.randomUUID(),
    });
    w.setNotice(null);
  }
  /** This is the sole UI handler that invokes consume; no lifecycle or timer calls it. */
  async function confirm() {
    if (!selection || redeeming || w.busy || !w.fresh) return;
    setRedeeming(true);
    w.setError(null);
    try {
      const result = await bridge.consume(
        selection.accountKey,
        selection.credit.id,
        selection.attemptId,
      );
      w.setNotice(outcomeMessage(result));
      setSelection(null);
      await w.refresh();
    } catch (e) {
      w.setError(String(e));
      setSelection(null);
      await w.refresh();
      w.setError(String(e));
    } finally {
      setRedeeming(false);
    }
  }
  /** Apply only complete integer minute values from the custom field. */
  function applyInterval() {
    const n = Number(interval);
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      w.setError("请输入 1–60 的整数分钟");
      return;
    }
    w.setError(null);
    void w.update({ refreshMinutes: n });
  }
  /** Autostart is a deliberate user action; read the system status back after changing it. */
  async function toggleLogin() {
    setLoginBusy(true);
    try {
      await bridge.loginToggle(!login);
      setLogin(await bridge.loginStatus());
    } catch (e) {
      w.setError(String(e));
    } finally {
      setLoginBusy(false);
    }
  }
  const credits = sortedCredits(snapshot?.credits ?? []),
    available = credits.filter((c) => canUse(c, now));
  // The soonest-expiring usable card carries a standing gold tint, hover or not.
  const soonestId = available.length
    ? available.reduce((a, b) =>
        (a.expiresAt ?? Infinity) <= (b.expiresAt ?? Infinity) ? a : b,
      ).id
    : null;
  // Any tracked window at ≤10% remaining lights the alert state on the card.
  const lowQuota = [300, 10080].some((m) => {
    const v = remaining(snapshot?.windows.find((q) => q.minutes === m));
    return v != null && v <= 10;
  });
  const lastUpdate = snapshot
    ? new Date(snapshot.fetchedAt * 1000).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未更新";
  const resizeTitle = preferences.compact ? "展开卡片" : "收起卡片";
  return (
    <main
      ref={root}
      className={`card ${compact ? "compact" : "expanded"} ${w.lifecycle.reduceTransparency ? "opaque" : ""} ${lowQuota ? "quota-alert" : ""}`}
    >
      {bridge.native && (
        <div className="resize-edges" aria-hidden="true">
          {(
            [
              "North",
              "South",
              "East",
              "West",
              "NorthEast",
              "NorthWest",
              "SouthEast",
              "SouthWest",
            ] as const
          ).map((direction) => (
            <div
              key={direction}
              className={`resize-edge ${direction}`}
              title="拖动调整大小"
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                void bridge
                  .resizeDrag(direction)
                  .catch((error) => w.setError(String(error)));
              }}
            />
          ))}
        </div>
      )}
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
                  (w.busy ? "正在读取账号…" : "等待账号信息")}
              </span>
            </div>
            <span className="badge">
              {snapshot?.account.planType ?? "Codex"}
            </span>
          </>
        ) : (
          <div className="brand">
            <span className="brand-mark">C</span>
            <span>Codex</span>
            {preferences.alwaysOnTop && <Pin size={12} className="pin-mark" />}
          </div>
        )}
        <div className="toolbar">
          {!compact && !w.settings && !selection && (
            <>
              <button
                className="icon-button"
                aria-label="刷新额度"
                title="刷新额度"
                onClick={() => void w.refresh()}
                disabled={w.busy}
              >
                <RefreshCw size={17} className={w.busy ? "loading" : ""} />
              </button>
              <button
                className="icon-button"
                aria-label="偏好设置"
                title="偏好设置"
                onClick={() => w.setSettings(true)}
              >
                <Settings2 size={17} />
              </button>
            </>
          )}
          {w.settings || selection ? (
            <button
              className="icon-button glass-button"
              aria-label="返回卡片"
              disabled={redeeming}
              onClick={() => {
                w.setSettings(false);
                setSelection(null);
              }}
            >
              <X size={17} />
            </button>
          ) : (
            <button
              className="icon-button glass-button"
              aria-label={resizeTitle}
              title={resizeTitle}
              onClick={() => void w.update({ compact: !preferences.compact })}
            >
              {preferences.compact ? <Plus size={20} /> : <Minus size={20} />}
            </button>
          )}
        </div>
      </header>
      {w.settings ? (
        <section className="settings-view">
          <h1>偏好设置</h1>
          <p className="subtitle">按你的节奏，安静地更新。</p>
          <div className="setting-row">
            <span>自动刷新</span>
            <Switch
              label="自动刷新"
              checked={preferences.autoRefresh}
              onChange={() =>
                void w.update({ autoRefresh: !preferences.autoRefresh })
              }
            />
          </div>
          <div className="segments">
            {[1, 5, 15].map((n) => (
              <button
                key={n}
                className={preferences.refreshMinutes === n ? "selected" : ""}
                onClick={() => void w.update({ refreshMinutes: n })}
              >
                {n} 分钟
              </button>
            ))}
          </div>
          <div className="setting-row custom-interval">
            <label htmlFor="interval">自定义间隔</label>
            <div>
              <input
                id="interval"
                type="number"
                min="1"
                max="60"
                step="1"
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyInterval();
                }}
              />
              <span>分钟</span>
              <button className="text-button" onClick={applyInterval}>
                应用
              </button>
            </div>
          </div>
          <div className="divider" />
          <div className="setting-row">
            <span>始终置顶</span>
            <Switch
              label="始终置顶"
              checked={preferences.alwaysOnTop}
              onChange={() =>
                void w.update({ alwaysOnTop: !preferences.alwaysOnTop })
              }
            />
          </div>
          <div className="setting-row">
            <span>菜单栏图标</span>
            <Switch
              label="显示菜单栏图标"
              checked={preferences.showTrayIcon}
              onChange={() =>
                void w.update({ showTrayIcon: !preferences.showTrayIcon })
              }
            />
          </div>
          <div className="setting-row">
            <span>随 Codex 显示卡片</span>
            <Switch
              label="随 Codex 显示卡片"
              checked={preferences.followCodex}
              onChange={() =>
                void w.update({ followCodex: !preferences.followCodex })
              }
            />
          </div>
          <div className="setting-row">
            <span>登录 Mac 时启动助手</span>
            <Switch
              label="登录 Mac 时启动助手"
              checked={login}
              disabled={loginBusy || w.demo}
              onChange={() => void toggleLogin()}
            />
          </div>
          <p className="setting-help">
            助手运行期间会跟随 Codex 启停。隐藏菜单栏图标后，展开卡片仍可进入设置恢复显示。
          </p>
          <button className="primary full" onClick={() => w.setSettings(false)}>
            完成 <Check size={15} />
          </button>
        </section>
      ) : selection ? (
        <section className="confirmation">
          <span className="eyebrow">使用重置卡</span>
          <h1>确认使用这张卡？</h1>
          <p className="account-confirm">{selection.email}</p>
          <div className="confirmation-credit">
            <h2>{localizedTitle(selection.credit.title) || "所选重置卡"}</h2>
            <p>
              {expiryDate(selection.credit.expiresAt)}
              {selection.credit.expiresAt != null ? " 到期" : ""}
            </p>
            <strong>
              {selection.credit.expiresAt != null
                ? `剩余 ${duration(selection.credit.expiresAt, now)}`
                : "到期时间未提供"}
            </strong>
          </div>
          <p className="confirm-help">
            使用后将更新额度和卡片状态，实际重置范围由 Codex 决定。
          </p>
          {w.demo && <p className="demo-label">演示操作，不会消耗真实卡片</p>}
          <div className="confirmation-actions">
            <button
              className="secondary-button"
              disabled={redeeming}
              onClick={() => setSelection(null)}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={
                redeeming ||
                w.busy ||
                !w.fresh ||
                !canUse(selection.credit, now) ||
                snapshot?.account.key !== selection.accountKey
              }
              onClick={() => void confirm()}
            >
              {redeeming ? "正在处理…" : "确认使用"}
              <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* Expanded view carries the full account row; mini bar shows it in the header. */}
          {!compact && (
            <div className="account-row">
              <div>
                <span className="email" title={snapshot?.account.email ?? ""}>
                  {snapshot?.account.email ??
                    (w.busy ? "正在读取账号…" : "等待账号信息")}
                </span>
                {snapshot?.account.workspaceName && (
                  <small>{snapshot.account.workspaceName}</small>
                )}
              </div>
              <span className="badge">
                {snapshot?.account.planType ?? "Codex"}
              </span>
            </div>
          )}
          {compact ? (
            /* Mini bar: two thin quota lines replace the large gauges. */
            <div className="mini-quotas">
              <MiniQuota
                window={snapshot?.windows.find((q) => q.minutes === 300)}
                label="5 小时"
                now={now}
              />
              <MiniQuota
                window={snapshot?.windows.find((q) => q.minutes === 10080)}
                label="周"
                secondary
                now={now}
              />
            </div>
          ) : (
            <div className="gauges">
              <Gauge
                window={snapshot?.windows.find((q) => q.minutes === 300)}
                label="5 小时额度"
                now={now}
              />
              <Gauge
                window={snapshot?.windows.find((q) => q.minutes === 10080)}
                label="周额度"
                now={now}
                secondary
              />
            </div>
          )}
          {!compact && (
            <section className="credits-section">
              <div className="section-heading">
                <h1>我的重置卡</h1>
                <span className="badge">
                  {snapshot?.availableCount == null
                    ? "数量未提供"
                    : `${snapshot.availableCount} 张可用`}
                </span>
              </div>
              {snapshot?.detailState === "unknown" && (
                <p className="empty-state">暂未提供卡片明细，刷新后再试。</p>
              )}
              {snapshot?.detailState === "partial" && (
                <p className="inline-hint">当前仅显示服务端返回的部分卡片。</p>
              )}
              {snapshot?.detailState === "empty" && (
                <p className="empty-state">暂时没有可用重置卡。</p>
              )}
              {!snapshot && (
                <p className="empty-state">读取账号后查看可用重置卡。</p>
              )}
              <div className="credit-list">
                {credits.map((credit, index) => {
                  const usable = canUse(credit, now),
                    urgent =
                      usable &&
                      credit.expiresAt != null &&
                      credit.expiresAt - now < 43200;
                  return (
                    <article
                      className={`credit ${credit.id === soonestId ? "soonest" : ""} ${urgent ? "urgent" : ""}`}
                      key={credit.id}
                    >
                      <div className="credit-info">
                        <div className="credit-heading">
                          <h2 title={localizedTitle(credit.title) ?? ""}>
                            {localizedTitle(credit.title) ||
                              `重置卡 ${index + 1}`}
                          </h2>
                          {available[0]?.id === credit.id &&
                            credit.expiresAt != null && (
                              <span className="expiry-badge">最近到期</span>
                            )}
                        </div>
                        <strong>
                          {usable
                            ? credit.expiresAt == null
                              ? "未提供到期时间"
                              : `剩余 ${duration(credit.expiresAt, now)}`
                            : credit.expiresAt != null &&
                                credit.expiresAt <= now
                              ? "已到期"
                              : credit.status === "redeeming"
                                ? "正在处理"
                                : "不可使用"}
                        </strong>
                        <small>
                          {credit.expiresAt != null
                            ? `${expiryDate(credit.expiresAt)} 到期`
                            : "到期信息以服务端为准"}
                        </small>
                      </div>
                      <button
                        className={
                          urgent
                            ? "primary use-button"
                            : "secondary-button use-button"
                        }
                        disabled={!usable || !w.fresh || w.busy}
                        onClick={() => choose(credit)}
                      >
                        使用
                      </button>
                    </article>
                  );
                })}
              </div>
              <footer>
                <span>
                  <i className={w.fresh ? "status-dot" : "status-dot stale"} />
                  {w.busy
                    ? "更新中…"
                    : `${w.fresh ? "更新于" : "缓存于"} ${lastUpdate}`}
                </span>
                <span>
                  {preferences.autoRefresh
                    ? `每 ${preferences.refreshMinutes} 分钟刷新`
                    : "手动刷新"}
                </span>
              </footer>
            </section>
          )}
        </>
      )}
      {(w.error || (!w.fresh && !!snapshot && !w.busy)) && (
        <div className="status-banner" role="status">
          <Clock3 size={13} />
          <span>{w.error ?? `上次数据 ${lastUpdate}，等待刷新`}</span>
          {!selection && !w.settings && (
            <button
              aria-label="重试刷新"
              onClick={() => void w.refresh()}
              disabled={w.busy}
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      )}
      {w.notice && (
        <div className="notice" role="status">
          <span>{w.notice}</span>
          <button aria-label="关闭提示" onClick={() => w.setNotice(null)}>
            <X size={13} />
          </button>
        </div>
      )}
      {w.demo && !selection && (
        <div className="demo-label">演示模式 · 不连接真实账号</div>
      )}
    </main>
  );
}
/** Accessible switch with an explicit label for keyboard and screen-reader use. */
function Switch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "on" : ""}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
    >
      <span />
    </button>
  );
}
/**
 * One-line quota summary for the mini bar. Unknown data stays unknown:
 * the bar empties and the reading shows a dash instead of an invented value.
 */
function MiniQuota({
  window,
  label,
  now,
  secondary = false,
}: {
  window?: QuotaWindow;
  label: string;
  now: number;
  secondary?: boolean;
}) {
  const value = remaining(window);
  const recovery =
    window?.resetsAt == null
      ? "恢复时间未提供"
      : window.resetsAt <= now
        ? "等待更新"
        : `${duration(window.resetsAt, now)}后恢复`;
  return (
    <div
      className={`mini-quota ${secondary ? "secondary" : ""} ${value != null && value <= 10 ? "alert" : ""}`}
      title={`${label}剩余 ${value == null ? "未提供" : `${Math.round(value)}%`}，${recovery}`}
    >
      <span className="mini-label">{label}</span>
      <span className="mini-track" aria-hidden="true">
        <span className="mini-fill" style={{ width: `${value ?? 0}%` }} />
      </span>
      <strong>{value == null ? "—" : `${Math.round(value)}%`}</strong>
      <small>{recovery}</small>
    </div>
  );
}
