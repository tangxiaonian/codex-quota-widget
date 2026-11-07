import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import * as bridge from "../bridge";
import type { Preferences } from "../model";
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
        从本机 Codex 登录令牌读取当前账号的订阅日期。缺少日期时隐藏。
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
        <span>随 Codex 显示卡片</span>
        <Switch
          label="随 Codex 显示卡片"
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
        助手运行期间会跟随 Codex
        启停。隐藏菜单栏图标后，展开卡片仍可进入设置恢复显示。
      </p>
      <button className="primary full" onClick={() => onClose()}>
        完成 <Check size={15} />
      </button>
    </section>
  );
}
