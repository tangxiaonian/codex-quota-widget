import { useSources } from "./hooks/useSources";
import { SourceContent } from "./components/SourceContent";
import { useEffect } from "react";
import { Clock3, RefreshCw, X } from "lucide-react";
import { remaining } from "./model";
import { useWidget } from "./useWidget";
import { useWindowBehavior } from "./hooks/useWindowBehavior";
import { useSubscription } from "./hooks/useSubscription";
import { useRedemption } from "./hooks/useRedemption";
import { CardHeader } from "./components/CardHeader";
import { SettingsView } from "./components/SettingsView";
import { CreditConfirmation } from "./components/CreditConfirmation";
import { ResizeEdges } from "./components/ResizeEdges";
/** Compose views and navigation; native window control and consumption each have a separate owner. */
export default function App() {
  const w = useWidget();
  const { snapshot, preferences, now } = w;
  const sources = useSources(w);
  const {
    workbuddy: wb,
    antigravity,
    isAntigravity,
    isWorkbuddy,
    allSources,
    refreshAll,
    miniView,
  } = sources;
  const showingCodex = !isWorkbuddy && !isAntigravity;
  const activeSource = isAntigravity ? antigravity : isWorkbuddy ? wb : w;
  const subscription = useSubscription(
    preferences.codexEnabled && preferences.showSubscription,
    snapshot,
    now,
  );
  const redemption = useRedemption(w);
  const { selection, redeeming } = redemption;
  const compact = preferences.compact && !w.settings && !selection;
  const mode = w.settings
    ? "settings"
    : selection
      ? "confirmation"
      : compact
        ? "compact"
        : "expanded";
  useWindowBehavior(w.ready, mode, preferences, w.update, w.setError);
  /** Close auxiliary views without interrupting an explicit consumption request. */
  function back() {
    if (!redeeming) {
      redemption.cancel();
      w.setSettings(false);
    }
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [redeeming]);
  const lowQuota =
    showingCodex &&
    [300, 10080].some((m) => {
      const value = remaining(snapshot?.windows.find((q) => q.minutes === m));
      return value != null && value <= 10;
    });
  const statusText = sources.status(compact);
  const refreshVisible =
    compact && allSources ? refreshAll : activeSource.refresh;
  const visibleBusy =
    compact && allSources
      ? w.busy || wb.busy || antigravity.busy
      : activeSource.busy;
  return (
    <main
      className={`card ${compact ? "compact" : "expanded"} ${w.lifecycle.reduceTransparency ? "opaque" : ""} ${lowQuota ? "quota-alert" : ""}`}
    >
      {!compact && <ResizeEdges onError={w.setError} />}
      <CardHeader
        identity={
          isAntigravity
            ? {
                name: "Antigravity",
                plan: antigravity.snapshot?.plan ?? null,
              }
            : isWorkbuddy
              ? {
                  name: wb.snapshot?.name ?? "WorkBuddy",
                  plan: wb.snapshot?.plan ?? null,
                }
              : undefined
        }
        onMiniView={miniView}
        subscription={!showingCodex || allSources ? null : subscription}
        compact={compact}
        snapshot={snapshot}
        preferences={preferences}
        busy={visibleBusy}
        settings={w.settings}
        selection={!!selection}
        redeeming={redeeming}
        onRefresh={refreshVisible}
        onSettings={() => w.setSettings(true)}
        onBack={back}
        onToggle={() => void w.update({ compact: !preferences.compact })}
      />
      {w.settings ? (
        <SettingsView
          preferences={preferences}
          demo={w.demo}
          update={w.update}
          onError={w.setError}
          onClose={back}
        />
      ) : selection ? (
        <CreditConfirmation
          selection={selection}
          now={now}
          demo={w.demo}
          busy={w.busy}
          fresh={w.fresh}
          redeeming={redeeming}
          accountKey={snapshot?.account.key}
          onCancel={redemption.cancel}
          onConfirm={redemption.confirm}
        />
      ) : (
        <SourceContent
          widget={w}
          sources={sources}
          compact={compact}
          subscription={subscription?.full ?? null}
          onChoose={redemption.choose}
        />
      )}
      {statusText && (
        <div className="status-banner" role="status">
          <Clock3 size={13} />
          <span title={statusText}>{statusText}</span>
          {!selection && !w.settings && (
            <button
              aria-label="重试刷新"
              onClick={() => void refreshVisible()}
              disabled={visibleBusy}
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      )}
      {w.notice &&
        preferences.codexEnabled &&
        (showingCodex || (compact && allSources)) &&
        (!compact || !statusText) && (
          <div className="notice" role="status">
            <span title={w.notice}>
              {compact && allSources ? "Codex · " : ""}
              {w.notice}
            </span>
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
