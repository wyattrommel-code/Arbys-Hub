"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PinPad from "@/components/PinPad";

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

  return (
    <PinPad
      pin={pin}
      onChange={(next) => {
        setPin(next);
        setError("");
      }}
      error={error}
      loading={loading}
      title="Enter your PIN"
      subtitle="4-digit employee code"
    />
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
