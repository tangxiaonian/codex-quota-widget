import { useEffect } from "react";
import { Clock3, RefreshCw, X } from "lucide-react";
import { remaining } from "./model";
import { useWidget } from "./useWidget";
import { useWindowBehavior } from "./hooks/useWindowBehavior";
import { useRedemption } from "./hooks/useRedemption";
import { CardHeader } from "./components/CardHeader";
import { QuotaView } from "./components/QuotaView";
import { CreditList } from "./components/CreditList";
import { SettingsView } from "./components/SettingsView";
import { CreditConfirmation } from "./components/CreditConfirmation";
import { ResizeEdges } from "./components/ResizeEdges";
/** Compose views and navigation; native window control and consumption each have a separate owner. */
export default function App() {
  const w = useWidget();
  const { snapshot, preferences, now } = w;
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
  const lowQuota = [300, 10080].some((m) => {
    const value = remaining(snapshot?.windows.find((q) => q.minutes === m));
    return value != null && value <= 10;
  });
  const lastUpdate = snapshot
    ? new Date(snapshot.fetchedAt * 1000).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未更新";
  return (
    <main
      className={`card ${compact ? "compact" : "expanded"} ${w.lifecycle.reduceTransparency ? "opaque" : ""} ${lowQuota ? "quota-alert" : ""}`}
    >
      {!compact && <ResizeEdges onError={w.setError} />}
      <CardHeader
        compact={compact}
        snapshot={snapshot}
        preferences={preferences}
        busy={w.busy}
        settings={w.settings}
        selection={!!selection}
        redeeming={redeeming}
        onRefresh={w.refresh}
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
        <>
          <QuotaView
            compact={compact}
            snapshot={snapshot}
            busy={w.busy}
            now={now}
          />
          {!compact && (
            <CreditList
              snapshot={snapshot}
              now={now}
              busy={w.busy}
              fresh={w.fresh}
              preferences={preferences}
              lastUpdate={lastUpdate}
              onChoose={redemption.choose}
            />
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
