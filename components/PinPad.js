"use client";

import { useEffect } from "react";

export const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

export default function PinPad({
  pin,
  onChange,
  error,
  loading = false,
  title = "Enter your PIN",
  subtitle = "4-digit employee code",
  disabled = false,
  size = "default",
}) {
  const kiosk = size === "kiosk";
  const compact = size === "compact";
  const locked = loading || disabled;

  useEffect(() => {
    if (!compact) return;
    function typePin(event) {
      if (locked || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const current = String(pin || "");
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        if (current.length < 4) onChange(current + event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        onChange(current.slice(0, -1));
      }
    }
    window.addEventListener("keydown", typePin);
    return () => window.removeEventListener("keydown", typePin);
  }, [compact, locked, onChange, pin]);

  function handleKey(key) {
    if (locked) return;
    if (key === "⌫") {
      onChange(String(pin || "").slice(0, -1));
      return;
    }
    if (!key || String(pin || "").length >= 4) return;
    onChange(String(pin || "") + key);
  }

  return (
    <>
      {title ? (
        <h2
          className={`text-center font-semibold text-zinc-900 dark:text-zinc-50 ${
            compact ? "text-lg" : kiosk ? "text-2xl" : "text-xl"
          }`}
        >
          {title}
        </h2>
      ) : null}
      {subtitle ? (
        <p className={`text-center text-zinc-500 ${kiosk ? "mt-2 text-base" : "mt-1 text-sm"}`}>
          {subtitle}
        </p>
      ) : null}

      <div
        className={`flex justify-center gap-3 ${compact ? "mt-3" : kiosk ? "mt-8" : "mt-6"}`}
        aria-label="PIN entry progress"
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`rounded-full border-2 ${
              kiosk ? "h-5 w-5" : "h-4 w-4"
            } ${
              String(pin || "").length > i
                ? "border-[#C8102E] bg-[#C8102E]"
                : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
            }`}
          />
        ))}
      </div>

      {error ? (
        <p
          className={`text-center font-medium text-red-600 ${compact ? "mt-2 text-sm" : kiosk ? "mt-5 text-base" : "mt-4 text-sm"}`}
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className={`grid grid-cols-3 ${compact ? "mt-3 gap-2" : kiosk ? "mt-10 gap-3" : "mt-8 gap-3"}`}>
        {PIN_KEYS.map((key, idx) =>
          key === "" ? (
            <div key={`sp-${idx}`} aria-hidden="true" />
          ) : (
            <button
              key={key}
              type="button"
              disabled={locked}
              onClick={() => handleKey(key)}
              className={`flex items-center justify-center rounded-xl border border-zinc-200 bg-white font-semibold shadow-sm transition active:scale-95 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 ${
                compact ? "h-12 text-xl" : kiosk ? "min-h-[5.5rem] text-3xl" : "min-h-[4.5rem] text-2xl"
              }`}
            >
              {key}
            </button>
          )
        )}
      </div>
    </>
  );
}
