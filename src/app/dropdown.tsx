"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { icons } from "./icons";

export type DropdownOption = { value: string; label: string };

// The app's own dropdown (2026-10-09), instead of the browser's <select>, whose open list is drawn by the system and
// can't be styled. White rounded card, lime highlight, ✓ on the chosen one. Keyboard: ↑/↓, Home/End, Enter or Space to
// pick, Esc to close, type a letter to jump. With `name` it sends its value in a form; `required` shows "Please choose
// one." under it (not the browser's bubble).
// The list floats above everything (also the email panel) and opens upward when there's no room below.
export function Dropdown({
  options,
  value,
  defaultValue = "",
  onChange,
  name,
  placeholder = "Choose…",
  required,
  disabled,
  title,
  id,
  label,
  size = "sm",
  className = "",
  buttonClassName = "",
}: {
  options: DropdownOption[];
  value?: string; // controlled; leave out to let the dropdown keep its own value (starting at defaultValue)
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  title?: string;
  id?: string;
  label?: string; // aria-label, when there's no <label htmlFor>
  size?: "sm" | "lg";
  className?: string; // the wrapper (width, flex)
  buttonClassName?: string; // the closed box (border, padding, text size)
}) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [missing, setMissing] = useState(false); // required and empty when the form was sent
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const selected = options.find((o) => o.value === current);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  const choose = (v: string) => {
    setMissing(false);
    if (value === undefined) setOwn(v);
    if (v !== current) onChange?.(v);
    close();
  };
  const show = () => {
    if (disabled || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    setPos({ left: r.left, width: r.width, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), maxHeight: Math.min(320, up ? above : below) });
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  };

  // While open: keys go to the list; a click elsewhere, scrolling the page or resizing closes it.
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const shut = () => setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("scroll", away, true);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", shut);
    };
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // Typing letters jumps to the next option starting with them.
  const jump = (key: string, now: number) => {
    typed.current = { text: now - typed.current.at < 700 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now };
    const t = typed.current.text;
    const order = [...options.keys()].map((k) => (active + (t.length === 1 ? 1 : 0) + k) % options.length);
    const hit = order.find((i) => options[i].label.toLowerCase().startsWith(t));
    if (hit !== undefined) setActive(hit);
  };

  const onListKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((a) => Math.min(options.length - 1, a + 1)),
      ArrowUp: () => setActive((a) => Math.max(0, a - 1)),
      Home: () => setActive(0),
      End: () => setActive(options.length - 1),
      Enter: () => options[active] && choose(options[active].value),
      " ": () => options[active] && choose(options[active].value),
      Escape: () => close(),
      Tab: () => close(),
    };
    if (keys[e.key]) {
      e.preventDefault();
      e.stopPropagation(); // Esc closes only the list, not the email panel around it
      keys[e.key]();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) jump(e.key, e.timeStamp);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={button}
        id={id}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
        aria-describedby={missing ? `${listId}-missing` : undefined}
        className={`flex w-full items-center justify-between gap-3 text-left disabled:opacity-50 ${buttonClassName} ${missing ? "border-red-600!" : ""}`}
      >
        <span className={`truncate ${selected ? "" : "text-stone-400"}`}>{selected?.label ?? placeholder}</span>
        <span className={`shrink-0 text-stone-500 transition-transform ${open ? "rotate-180" : ""}`}>{icons.chevronDown}</span>
      </button>
      {missing && <p id={`${listId}-missing`} className="mt-2 text-sm text-red-700">Please choose one.</p>}
      {/* Carries the value in a form. If it's required and empty, our own hint shows instead of the browser's bubble. */}
      {name && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          required={required}
          value={current}
          onChange={() => {}}
          onInvalid={(e) => {
            e.preventDefault();
            setMissing(true);
            button.current?.focus();
          }}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        />
      )}
      {open &&
        pos &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, maxWidth: window.innerWidth - pos.left - 12, maxHeight: pos.maxHeight }}
            className={`fixed z-[70] overflow-y-auto rounded-xl border border-stone-200 bg-white p-1.5 text-ink shadow-xl focus:outline-none ${size === "lg" ? "text-lg" : "text-sm"}`}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.value === current}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o.value)}
                className={`flex cursor-pointer items-center justify-between gap-6 rounded-lg ${size === "lg" ? "px-4 py-3" : "px-3 py-2"} ${i === active ? "bg-brand" : ""} ${o.value === current ? "font-semibold" : ""}`}
              >
                <span>{o.label}</span>
                {o.value === current && <span aria-hidden="true">✓</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

// Time zones as dropdown options, e.g. "America/New York time".
export const timeZoneOptions = (zones: string[]) => zones.map((z) => ({ value: z, label: `${z.replace("_", " ")} time` }));
