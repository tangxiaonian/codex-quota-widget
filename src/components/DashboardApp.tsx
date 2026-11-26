import { useCallback, useEffect, useState } from "react";
import { BarChart3, Settings2 } from "lucide-react";
import * as bridge from "../bridge";
import { defaults, type Preferences } from "../model";
import { useTheme } from "../hooks/useTheme";
import { SettingsView } from "./SettingsView";
import { UsageView } from "./UsageView";

/** Standalone control-center window (usage analytics + preferences), created on demand. */
export function DashboardApp() {
  const initialTab =
    new URLSearchParams(location.search).get("tab") === "settings"
      ? "settings"
      : "usage";
  const [tab, setTab] = useState<"usage" | "settings">(initialTab);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useTheme(preferences.theme);

  useEffect(() => {
    document.body.classList.add("dashboard-body");
    let mounted = true;
    const cleanups: (() => void)[] = [];
    void bridge
      .bootstrap()
      .then((b) => {
        if (!mounted) return;
        setPreferences(b.preferences);
        setDemo(!!b.demo);
      })
      .catch((e) => setError(String(e)));

    void bridge
      .onPreferencesUpdated((next) => setPreferences(next))
      .then((fn) => cleanups.push(fn));
    void bridge
      .onDashboardTab((nextTab) => setTab(nextTab))
      .then((fn) => cleanups.push(fn));

    return () => {
      mounted = false;
      cleanups.forEach((fn) => fn());
      document.body.classList.remove("dashboard-body");
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<Preferences>) => {
      const next = { ...preferences, ...patch };
      setPreferences(next);
      try {
        await bridge.save(next);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [preferences],
  );

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar" aria-label="控制中心导航">
        <div className="dash-brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>额度卡片</strong>
            <small>控制中心</small>
          </div>
        </div>
        <nav className="dash-nav">
          <button
            type="button"
            className={tab === "usage" ? "active" : ""}
            onClick={() => setTab("usage")}
          >
            <BarChart3 size={15} /> Token 用量
          </button>
          <button
            type="button"
            className={tab === "settings" ? "active" : ""}
            onClick={() => setTab("settings")}
          >
            <Settings2 size={15} /> 偏好设置
          </button>
        </nav>
      </aside>

      <main className="dashboard-main">
        <header className="dash-header">
          <h1>{tab === "usage" ? "本地 Token 用量统计" : "偏好设置"}</h1>
          {error && <span className="dash-inline-error">{error}</span>}
        </header>
        <div className="dash-scroll">
          {tab === "usage" ? (
            <UsageView preferences={preferences} update={update} />
          ) : (
            <SettingsView
              preferences={preferences}
              demo={demo}
              embedded={false}
              update={update}
              onError={setError}
            />
          )}
        </div>
      </main>
    </div>
  );
}
