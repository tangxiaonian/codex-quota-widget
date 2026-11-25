import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import * as bridge from "../bridge";
import { sourceOptions, type Preferences } from "../model";
import { Switch } from "./Switch";
/** Own settings form drafts and OS login-item status; never perform account operations. */
export function SettingsView({
  preferences,
  demo,
  update,
  onError,
  onClose,
}: {
  preferences: Preferences;
  demo: boolean;
  update: (patch: Partial<Preferences>) => Promise<void>;
  onError: (message: string | null) => void;
  onClose: () => void;
}) {
  const [interval, setIntervalValue] = useState(
    String(preferences.refreshMinutes),
  );
  const [login, setLogin] = useState(false),
    [loginBusy, setLoginBusy] = useState(false);
  useEffect(() => {
    setIntervalValue(String(preferences.refreshMinutes));
  }, [preferences.refreshMinutes]);
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
    <section className="settings-view">
      <h1>偏好设置</h1>
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
      <div className="setting-row">
        <span>迷你条显示</span>
        <select
          aria-label="迷你条显示"
          value={preferences.compactView}
          onChange={(e) =>
            void update({ compactView: e.target.value as "all" | "current" })
          }
        >
          <option value="all">全部来源</option>
          <option value="current">当前来源</option>
        </select>
      </div>
      <p className="subtitle">按你的节奏，安静地更新。</p>
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
          <button className="text-button" onClick={applyInterval}>
            应用
          </button>
        </div>
      </div>
      <div className="divider" />
      <div className="setting-row">
        <span>显示订阅有效期</span>
        <Switch
          label="显示订阅有效期"
          checked={preferences.showSubscription}
          onChange={() =>
            void update({ showSubscription: !preferences.showSubscription })
          }
        />
      </div>
      <p className="setting-help">
        优先读取本地日期。上期结束后，会使用当前账号向 ChatGPT
        查询新日期，必要时由 Codex 刷新登录信息。
      </p>
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
        助手运行期间会跟随已启用应用显示。隐藏菜单栏图标后，展开卡片仍可进入设置恢复显示。
      </p>
      <button className="primary full" onClick={() => onClose()}>
        完成 <Check size={15} />
      </button>
    </section>
  );
}
