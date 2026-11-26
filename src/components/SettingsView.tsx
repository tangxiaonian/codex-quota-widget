import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import * as bridge from "../bridge";
import {
  sourceOptions,
  type DesktopMode,
  type Preferences,
  type RailEdge,
  type ThemeMode,
} from "../model";
import { Switch } from "./Switch";

/** Own settings form drafts and OS login-item status; never perform account operations. */
export function SettingsView({
  preferences,
  demo,
  embedded = true,
  update,
  onError,
  onClose,
}: {
  preferences: Preferences;
  demo: boolean;
  embedded?: boolean;
  update: (patch: Partial<Preferences>) => Promise<void>;
  onError: (message: string | null) => void;
  onClose?: () => void;
}) {
  const [interval, setIntervalValue] = useState(
    String(preferences.refreshMinutes),
  );
  const [rateText, setRateText] = useState(String(preferences.usdToCny));
  const [login, setLogin] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    setIntervalValue(String(preferences.refreshMinutes));
  }, [preferences.refreshMinutes]);
  useEffect(() => {
    setRateText(String(preferences.usdToCny));
  }, [preferences.usdToCny]);
  useEffect(() => {
    void bridge
      .loginStatus()
      .then(setLogin)
      .catch((e) => onError(String(e)));
  }, [onError]);

  /** Apply only complete integer minute values from the custom field. */
  function applyInterval() {
    const n = Number(interval);
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      onError("请输入 1–60 的整数分钟");
      return;
    }
    onError(null);
    void update({ refreshMinutes: n });
  }

  /** Apply a positive exchange rate used exclusively for local CNY cost display. */
  function applyRate() {
    const n = Number(rateText);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      onError("请输入 0–100 之间的有效汇率");
      return;
    }
    onError(null);
    void update({ usdToCny: Number(n.toFixed(3)) });
  }

  /** Autostart is a deliberate user action; read the system status back after changing it. */
  async function toggleLogin() {
    setLoginBusy(true);
    try {
      await bridge.loginToggle(!login);
      setLogin(await bridge.loginStatus());
    } catch (e) {
      onError(String(e));
    } finally {
      setLoginBusy(false);
    }
  }

  return (
    <section className={`settings-view ${embedded ? "" : "dashboard-settings"}`}>
      {embedded && <h1>偏好设置</h1>}

      <div className="settings-group">
        <h2>外观与桌面形态</h2>
        <div className="setting-row">
          <span>桌面显示形态</span>
          <div className="segments compact-seg">
            {(
              [
                ["rail", "贴边圆环条"],
                ["mini", "迷你横条"],
                ["hidden", "仅菜单栏"],
              ] as [DesktopMode, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={preferences.desktopMode === val ? "selected" : ""}
                onClick={() =>
                  void update({
                    desktopMode: val,
                    ...(val !== "hidden" ? { compact: true } : {}),
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {preferences.desktopMode === "rail" && (
          <>
            <div className="setting-row">
              <span>贴边方向</span>
              <div className="segments compact-seg">
                {(
                  [
                    ["right", "屏幕右侧"],
                    ["left", "屏幕左侧"],
                  ] as [RailEdge, string][]
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    className={preferences.railEdge === val ? "selected" : ""}
                    onClick={() => void update({ railEdge: val })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>空闲折叠为贴边细条</span>
              <Switch
                label="空闲折叠为贴边细条"
                checked={preferences.railAutoCollapse}
                onChange={() =>
                  void update({
                    railAutoCollapse: !preferences.railAutoCollapse,
                  })
                }
              />
            </div>
          </>
        )}

        <div className="setting-row">
          <span>玻璃主题</span>
          <div className="segments compact-seg">
            {(
              [
                ["system", "跟随系统"],
                ["light", "浅色"],
                ["dark", "暗黑"],
              ] as [ThemeMode, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={preferences.theme === val ? "selected" : ""}
                onClick={() => void update({ theme: val })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <span>截图时隐藏悬浮窗</span>
          <Switch
            label="截图时隐藏悬浮窗"
            checked={preferences.hideFromCapture}
            onChange={() =>
              void update({ hideFromCapture: !preferences.hideFromCapture })
            }
          />
        </div>
        <p className="setting-help">
          开启后常规窗口截图会自动跳过悬浮卡片；macOS 系统录屏或部分屏幕共享工具仍可能捕获。
        </p>
      </div>

      <div className="divider" />

      <div className="settings-group">
        <h2>额度来源</h2>
        {sourceOptions.map((source) => {
          const enabled = preferences[source.enabled];
          const replacement = sourceOptions.find(
            (other) => other.id !== source.id && preferences[other.enabled],
          );
          return (
            <div className="setting-row" key={source.id}>
              <span>{source.name}</span>
              <Switch
                label={`启用 ${source.name}`}
                checked={enabled}
                disabled={enabled && !replacement}
                onChange={() =>
                  void update({
                    [source.enabled]: !enabled,
                    ...(enabled &&
                    preferences.selectedSource === source.id &&
                    replacement
                      ? { selectedSource: replacement.id }
                      : {}),
                  })
                }
              />
            </div>
          );
        })}
        <p className="setting-help">
          WorkBuddy 读取当前登录账号。Antigravity 优先读取运行中的桌面端，未运行时回退到本机 agy CLI。
        </p>
      </div>

      <div className="divider" />

      <div className="settings-group">
        <h2>刷新与换算</h2>
        <div className="setting-row">
          <span>自动刷新</span>
          <Switch
            label="自动刷新"
            checked={preferences.autoRefresh}
            onChange={() =>
              void update({ autoRefresh: !preferences.autoRefresh })
            }
          />
        </div>
        <div className="segments">
          {[1, 5, 15].map((n) => (
            <button
              key={n}
              type="button"
              className={preferences.refreshMinutes === n ? "selected" : ""}
              onClick={() => void update({ refreshMinutes: n })}
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
            <button type="button" className="text-button" onClick={applyInterval}>
              应用
            </button>
          </div>
        </div>
        <div className="setting-row custom-interval">
          <label htmlFor="usd-cny">参考汇率（USD→CNY）</label>
          <div>
            <input
              id="usd-cny"
              type="number"
              min="1"
              max="100"
              step="0.05"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyRate();
              }}
            />
            <button type="button" className="text-button" onClick={applyRate}>
              应用
            </button>
          </div>
        </div>
      </div>

      <div className="divider" />

      <div className="settings-group">
        <h2>窗口与系统</h2>
        <div className="setting-row">
          <span>显示 Codex 订阅有效期</span>
          <Switch
            label="显示订阅有效期"
            checked={preferences.showSubscription}
            onChange={() =>
              void update({ showSubscription: !preferences.showSubscription })
            }
          />
        </div>
        <div className="setting-row">
          <span>始终置顶</span>
          <Switch
            label="始终置顶"
            checked={preferences.alwaysOnTop}
            onChange={() =>
              void update({ alwaysOnTop: !preferences.alwaysOnTop })
            }
          />
        </div>
        <div className="setting-row">
          <span>菜单栏图标</span>
          <Switch
            label="显示菜单栏图标"
            checked={preferences.showTrayIcon}
            onChange={() =>
              void update({ showTrayIcon: !preferences.showTrayIcon })
            }
          />
        </div>
        <div className="setting-row">
          <span>随已启用应用显示卡片</span>
          <Switch
            label="随已启用应用显示卡片"
            checked={preferences.followCodex}
            onChange={() =>
              void update({ followCodex: !preferences.followCodex })
            }
          />
        </div>
        <div className="setting-row">
          <span>登录 Mac 时启动助手</span>
          <Switch
            label="登录 Mac 时启动助手"
            checked={login}
            disabled={loginBusy || demo}
            onChange={() => void toggleLogin()}
          />
        </div>
        <p className="setting-help">
          助手运行期间会跟随已启用应用显示。隐藏菜单栏图标后，展开卡片或圆环条底部按钮仍可打开控制中心恢复。
        </p>
      </div>

      {embedded && onClose && (
        <button type="button" className="primary full" onClick={onClose}>
          完成 <Check size={15} />
        </button>
      )}
    </section>
  );
}
