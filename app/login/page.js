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
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState("07462");

  useEffect(() => {
    fetch("/api/auth/stores").then((response) => response.json()).then((data) => setStores(data.stores || [])).catch(() => {});
  }, []);

  const submitPin = useCallback(
    async (value) => {
      if (value.length !== 4) return;
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: value, store_id: storeId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || "Invalid PIN");
          setPin("");
          return;
        }
        const destination = from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login") ? from : "/";
        router.replace(storeId === "07462" ? destination : "/database");
        router.refresh();
      } catch {
        setError("Login failed. Try again.");
        setPin("");
      } finally {
        setLoading(false);
      }
    },
    [from, router, storeId]
  );

  useEffect(() => {
    if (pin.length === 4) {
      submitPin(pin);
    }
  }, [pin, submitPin]);

  return (
    <>
    {stores.length > 1 ? <label className="mb-5 flex flex-col gap-2 text-sm font-semibold">Store<select aria-label="Store" className="rounded-lg border border-zinc-300 bg-white p-3 text-zinc-900" value={storeId} onChange={(event) => { setStoreId(event.target.value); setPin(""); setError(""); }} disabled={loading}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.number ? ` · ${store.number}` : ""}</option>)}</select></label> : null}
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
