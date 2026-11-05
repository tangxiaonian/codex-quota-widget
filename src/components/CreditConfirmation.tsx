import { ArrowUpRight } from "lucide-react";
import { canUse, duration, expiryDate, localizedTitle } from "../model";
import type { Selection } from "../hooks/useRedemption";
/** Present the captured account and selected card without initiating any implicit consumption. */
export function CreditConfirmation({
  selection,
  now,
  demo,
  busy,
  fresh,
  redeeming,
  accountKey,
  onCancel,
  onConfirm,
}: {
  selection: Selection;
  now: number;
  demo: boolean;
  busy: boolean;
  fresh: boolean;
  redeeming: boolean;
  accountKey?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
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
      {demo && <p className="demo-label">演示操作，不会消耗真实卡片</p>}
      <div className="confirmation-actions">
        <button
          className="secondary-button"
          disabled={redeeming}
          onClick={() => onCancel()}
        >
          取消
        </button>
        <button
          className="primary"
          disabled={
            redeeming ||
            busy ||
            !fresh ||
            !canUse(selection.credit, now) ||
            accountKey !== selection.accountKey
          }
          onClick={() => void onConfirm()}
        >
          {redeeming ? "正在处理…" : "确认使用"}
          <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  );
}
