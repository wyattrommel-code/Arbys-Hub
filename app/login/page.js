"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submitPin = useCallback(
    async (value) => {
      if (value.length !== 4) return;
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: value }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || "Invalid PIN");
          setPin("");
          return;
        }
        router.replace(from.startsWith("/login") ? "/" : from);
        router.refresh();
      } catch {
        setError("Login failed. Try again.");
        setPin("");
      } finally {
        setLoading(false);
      }
    },
    [from, router]
  );

  useEffect(() => {
    if (pin.length === 4) {
      submitPin(pin);
    }
  }, [pin, submitPin]);

  function handleKey(key) {
    if (loading) return;
    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
      setError("");
      return;
    }
    if (!key || pin.length >= 4) return;
    setPin((p) => p + key);
    setError("");
  }

  return (
    <>
      <h2 className="text-center text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Enter your PIN
      </h2>
      <p className="mt-1 text-center text-sm text-zinc-500">4-digit employee code</p>

      <div className="mt-6 flex justify-center gap-3" aria-label="PIN entry progress">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 ${
              pin.length > i
                ? "border-[#C8102E] bg-[#C8102E]"
                : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
            }`}
          />
        ))}
      </div>

      {error ? (
        <p className="mt-4 text-center text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-3 gap-3">
        {KEYS.map((key, idx) =>
          key === "" ? (
            <div key={`sp-${idx}`} aria-hidden="true" />
          ) : (
            <button
              key={key}
              type="button"
              disabled={loading}
              onClick={() => handleKey(key)}
              className="flex min-h-[4.5rem] items-center justify-center rounded-xl border border-zinc-200 bg-white text-2xl font-semibold shadow-sm transition active:scale-95 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {key}
            </button>
          )
        )}
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <section className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-8">
      <Suspense fallback={<p className="text-center text-sm text-zinc-500">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </section>
  );
}
