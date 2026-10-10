"use client";

import { startTransition, useActionState, useCallback, useEffect, useState, type ReactNode } from "react";
import type { ActionState } from "./action-state";
import { ConfirmDialog, type Confirm } from "./confirm-dialog";

// A button that runs a server action and shows its result message next to it.
export function ActionButton({
  action,
  label,
  pendingLabel = "Working…",
  variant = "primary",
  disabled,
  title,
  confirm,
  icon,
  hideAfter,
}: {
  action: () => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "quiet" | "outline" | "lime" | "softLime" | "limeLg" | "outlineLg" | "limeSm" | "outlineSm" | "icon" | "darkLg";
  disabled?: boolean;
  title?: string;
  confirm?: Confirm; // asked first, in the app's own dialog (e.g. for a delete)
  icon?: ReactNode; // shown after the label (e.g. an arrow); with variant "icon", shown instead of it
  hideAfter?: number; // ms: a success message goes away by itself (errors stay), e.g. Check Gmail
}) {
  const [state, run, pending] = useActionState<ActionState>(action, null);
  const [hidden, setHidden] = useState<ActionState>(null); // the message that has timed out
  useEffect(() => {
    if (!hideAfter || !state?.ok) return;
    const t = setTimeout(() => setHidden(state), hideAfter);
    return () => clearTimeout(t);
  }, [state, hideAfter]);
  const [asking, setAsking] = useState(false);
  const cancel = useCallback(() => setAsking(false), []);
  const style = {
    primary: "bg-zinc-900 text-white",
    secondary: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
    // Briefs page Clear (Not briefs): grey text, same height as the lime button; on hover a beige that shows on the cream page.
    quiet: "rounded-xl! px-3! py-2.5! text-base! text-stone-500 hover:bg-stone-300/70 hover:text-ink",
    // Briefs page (2026-10-09 mockup): large outlined button.
    outline: "rounded-xl! border border-stone-300 px-5! py-2.5! text-base! text-ink hover:bg-white",
    // Briefs page Create spec: lime, bold, same size as outline (border keeps the height equal).
    lime: "inline-flex items-center gap-5 rounded-xl! border border-brand bg-brand px-5! py-2.5! text-base! font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover",
    // Not briefs' This is a brief: pale lime with a thin border, bright lime on hover (user's mockup); same size as lime.
    softLime: "rounded-xl! border border-olive-line bg-tint px-5! py-2.5! text-base! text-ink transition-colors hover:border-brand hover:bg-brand",
    // Approval queue (2026-10-09 mockup): the card's main button (lime) and side buttons (outlined, white fill);
    // made compact later the same day, now the same size as lime / outline.
    limeLg: "inline-flex items-center gap-5 rounded-xl! border border-brand bg-brand px-5! py-2.5! text-base! font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover",
    outlineLg: "rounded-xl! border border-stone-300 bg-white px-5! py-2.5! text-base! text-ink hover:bg-stone-100",
    // Job page candidate cards (pre-screen, client's answer, interview, outcome): smaller lime / outlined buttons.
    limeSm: "inline-flex items-center gap-2 rounded-lg! border border-brand bg-brand px-4! py-2! text-sm! font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover",
    outlineSm: "rounded-lg! border border-stone-300 bg-white px-4! py-2! text-sm! text-ink hover:bg-stone-100",
    // Briefs page bin: square outlined icon button, same height as outline; red on hover.
    icon: "rounded-xl! border border-stone-300 p-3! text-stone-500 hover:bg-white hover:text-red-700",
    // "The next useful thing" banner (Job page): big dark button on lime, for an action that starts an agent.
    darkLg: "inline-flex items-center gap-3 rounded-xl! border border-ink bg-ink px-7! py-4! text-lg! font-semibold text-white hover:bg-black",
  }[variant];
  const iconOnly = variant === "icon";
  return (
    <form
      action={run}
      className="flex items-center gap-3"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        if (!confirm) return;
        e.preventDefault();
        setAsking(true);
      }}
    >
      {state && state !== hidden && <span className={`max-w-md text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
      <button
        disabled={disabled || pending}
        title={title ?? (iconOnly ? label : undefined)}
        aria-label={iconOnly ? label : undefined}
        className={`whitespace-nowrap rounded px-3 py-1.5 text-sm ${variant.startsWith("lime") ? "" : "disabled:opacity-40"} ${style}`}
      >
        {iconOnly ? icon : pending ? pendingLabel : label}
        {!iconOnly && !pending && icon}
      </button>
      {asking && confirm && (
        <ConfirmDialog
          confirm={confirm}
          onCancel={cancel}
          onOk={() => {
            setAsking(false);
            startTransition(() => run());
          }}
        />
      )}
    </form>
  );
}
