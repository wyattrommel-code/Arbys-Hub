"use client";

import { useCallback, useEffect, useState } from "react";
import FaceCapture from "@/components/clock/FaceCapture";
import PinPad from "@/components/PinPad";
import { STORE_TIMEZONE } from "@/lib/constants";
import { formatClock } from "@/lib/schedule";
import { formatStoreTime, getStoreToday } from "@/lib/store-time";

function formatWorkedHoursLabel(workedMinutes) {
  const hrs = Number(workedMinutes) / 60;
  if (!Number.isFinite(hrs) || hrs < 0) return "0.0 hrs";
  return `${hrs.toFixed(1)} hrs`;
}

function nowLabel() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

export default function ClockKiosk() {
  const [clock, setClock] = useState("");
  const [today, setToday] = useState("");
  const [step, setStep] = useState("pin");
  const [pin, setPin] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setClock(nowLabel());
    setToday(getStoreToday());
    const id = window.setInterval(() => setClock(nowLabel()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const reset = useCallback(() => {
    setStep("pin");
    setPin("");
    setManagerPin("");
    setError("");
    setLoading(false);
    setSession(null);
    setResult(null);
  }, []);

  useEffect(() => {
    if (step !== "done") return undefined;
    const id = window.setTimeout(reset, 6000);
    return () => window.clearTimeout(id);
  }, [step, reset]);

  const identify = useCallback(async (value) => {
    if (value.length !== 4) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clock/identify", {
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
      setSession(data);
      setStep("ready");
    } catch {
      setError("Could not reach the time clock. Try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === "pin" && pin.length === 4) identify(pin);
  }, [pin, step, identify]);

  const needsPhotoFor = useCallback((sess) => {
    if (!sess) return false;
    if (sess.action === "clock_out") return Boolean(sess.settings?.require_photo_on_clock_out);
    return Boolean(sess.settings?.require_face_on_clock_in);
  }, []);

  async function submitPunch(photoBlob, faceDetected) {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("pin", pin);
      if (session.needsAuthorization) form.set("manager_pin", managerPin);
      form.set("face_detected", faceDetected ? "true" : "false");
      if (photoBlob) form.set("file", photoBlob, "punch.jpg");
      const path = session.action === "clock_out" ? "/api/clock/out" : "/api/clock/in";
      const res = await fetch(path, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not save punch.");
        setLoading(false);
        if (needsPhotoFor(session)) setStep("photo");
        else setStep("ready");
        return;
      }
      setResult({
        action: session.action,
        name: session.employee?.name,
        clockIn: data.punch?.clock_in,
        workedMinutes: data.punch?.worked_minutes,
      });
      setStep("done");
    } catch {
      setError("Could not save punch. Try again.");
      if (needsPhotoFor(session)) setStep("photo");
      else setStep("ready");
    } finally {
      setLoading(false);
    }
  }

  function continueFromReady() {
    setError("");
    if (session?.action === "clock_in" && session.needsAuthorization && managerPin.length !== 4) {
      setStep("manager_pin");
      return;
    }
    if (needsPhotoFor(session)) {
      setStep("photo");
      return;
    }
    submitPunch(null, false);
  }

  return (
    <section className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-6">
      <header className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[#C8102E]">Arby&apos;s Hub</p>
        <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Time Clock</h1>
        <p className="mt-2 text-lg tabular-nums text-zinc-600 dark:text-zinc-300">{clock || "\u00a0"}</p>
        <p className="text-sm text-zinc-400">{today || "\u00a0"}</p>
      </header>

      <div className="mt-6 flex flex-1 flex-col">
        {step === "pin" ? (
          <PinPad
            pin={pin}
            onChange={(next) => {
              setPin(next);
              setError("");
            }}
            error={error}
            loading={loading}
            size="kiosk"
            title="Enter your PIN"
            subtitle="Clock in or out"
          />
        ) : null}

        {step === "manager_pin" ? (
          <>
            <PinPad
              pin={managerPin}
              onChange={(next) => {
                setManagerPin(next);
                setError("");
              }}
              error={error}
              loading={loading}
              size="kiosk"
              title="Manager authorize"
              subtitle="GM or assistant manager PIN"
            />
            <button
              type="button"
              disabled={loading || managerPin.length !== 4}
              onClick={() => {
                if (needsPhotoFor(session)) setStep("photo");
                else submitPunch(null, false);
              }}
              className="mt-8 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40"
            >
              Authorize & continue
            </button>
            <button
              type="button"
              className="mt-3 min-h-12 w-full rounded-2xl border border-zinc-300 text-base font-semibold dark:border-zinc-700"
              onClick={reset}
            >
              Cancel
            </button>
          </>
        ) : null}

        {step === "ready" && session ? (
          <ReadyCard
            session={session}
            error={error}
            loading={loading}
            onContinue={continueFromReady}
            onAuthorize={() => {
              setError("");
              setManagerPin("");
              setStep("manager_pin");
            }}
            onCancel={reset}
          />
        ) : null}

        {step === "photo" && session ? (
          <>
            {error ? (
              <p className="mb-3 text-center text-base font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <FaceCapture
              actionLabel={
                session.action === "clock_out" ? "Capture & clock out" : "Capture & clock in"
              }
              busy={loading}
              onCaptured={(blob) => submitPunch(blob, true)}
              onCancel={reset}
            />
          </>
        ) : null}

        {step === "done" && result ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
              {result.action === "clock_out" ? "Clocked out" : "Clocked in"}
            </p>
            <p className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              {result.action === "clock_out"
                ? `Clocked out — ${formatWorkedHoursLabel(result.workedMinutes)}`
                : `Clocked in at ${formatStoreTime(result.clockIn)}`}
            </p>
            {result.name ? <p className="mt-2 text-base text-zinc-500">{result.name}</p> : null}
            <button
              type="button"
              onClick={reset}
              className="mt-10 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white"
            >
              Done
            </button>
          </div>
        ) : null}
      </div>

      <a href="/" className="mt-8 pb-4 text-center text-sm text-zinc-400 hover:text-[#C8102E]">
        Back to Hub
      </a>
    </section>
  );
}

function ReadyCard({ session, error, loading, onContinue, onAuthorize, onCancel }) {
  const shift = session.shift;
  const clockingOut = session.action === "clock_out";

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-center text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        {session.employee?.name}
      </p>
      {clockingOut ? (
        <p className="mt-3 text-center text-lg text-zinc-600 dark:text-zinc-300">
          Clocked in at {formatStoreTime(session.openPunch?.clock_in)}. Clock out?
        </p>
      ) : session.needsAuthorization ? (
        <p className="mt-3 text-center text-lg font-medium text-red-700" role="alert">
          {session.message || "You're not scheduled today"}
        </p>
      ) : shift ? (
        <p className="mt-3 text-center text-lg text-zinc-600 dark:text-zinc-300">
          Scheduled {formatClock(shift.scheduled_start)} – {formatClock(shift.scheduled_end)}
          {shift.role || shift.station
            ? ` · ${[shift.role, shift.station].filter(Boolean).join(" · ")}`
            : ""}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 text-center text-base font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {clockingOut || !session.needsAuthorization ? (
        <button
          type="button"
          disabled={loading}
          onClick={onContinue}
          className="mt-8 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40"
        >
          {loading ? "Working…" : clockingOut ? "Clock out" : "Clock in"}
        </button>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={onAuthorize}
          className="mt-8 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40"
        >
          Manager authorize
        </button>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={onCancel}
        className="mt-3 min-h-12 w-full rounded-2xl border border-zinc-300 text-base font-semibold dark:border-zinc-700"
      >
        Cancel
      </button>
    </div>
  );
}
