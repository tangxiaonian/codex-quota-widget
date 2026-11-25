import type { WidgetState } from "../useWidget";
import type { SourceState } from "../hooks/useSources";
import type { Credit } from "../model";
import { SourceNavigation } from "./SourceNavigation";
import { MultiSourceMini } from "./MultiSourceMini";
import { AntigravityView } from "./AntigravityView";
import { WorkbuddyView } from "./WorkbuddyView";
import { WorkbuddyMini } from "./WorkbuddyMini";
import { QuotaView } from "./QuotaView";
import { CreditList } from "./CreditList";
/** Choose provider-specific views without sharing quota units or redemption actions. */
export function SourceContent({
  widget: w,
  sources: s,
  compact,
  subscription,
  onChoose,
}: {
  widget: WidgetState;
  sources: SourceState;
  compact: boolean;
  subscription: string | null;
  onChoose: (credit: Credit) => void;
}) {
  const { snapshot, preferences, now } = w;
  let detail;
  if (compact && s.allSources) {
    detail = (
      <MultiSourceMini
        preferences={preferences}
        codex={snapshot}
        codexError={s.codexStatus}
        workbuddy={s.workbuddy}
        antigravity={s.antigravity}
        onSelect={(id) => s.selectSource(id, true)}
      />
    );
  } else if (s.isAntigravity) {
    detail = (
      <AntigravityView state={s.antigravity} compact={compact} now={now} />
    );
  } else if (s.isWorkbuddy) {
    detail = compact ? (
      <WorkbuddyMini snapshot={s.workbuddy.snapshot} />
    ) : (
      <WorkbuddyView state={s.workbuddy} now={now} />
    );
  } else {
    detail = (
      <>
        <QuotaView
          subscription={subscription}
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
            lastUpdate={s.lastUpdate}
            onChoose={onChoose}
          />
        )}
      </>
    );
  }
  return (
    <>
      {!compact && (
        <SourceNavigation
          preferences={preferences}
          codex={snapshot}
          workbuddy={s.workbuddy.snapshot}
          codexError={s.codexStatus}
          workbuddyError={s.workbuddy.error}
          antigravity={s.antigravity.snapshot}
          antigravityError={s.antigravity.error}
          onSelect={(id) => s.selectSource(id)}
        />
      )}
      {detail}
    </>
  );
}
