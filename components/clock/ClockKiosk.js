"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import FaceCapture from "@/components/clock/FaceCapture";
import { createFaceDetector } from "@/lib/face-detect";
import PinPad from "@/components/PinPad";
import { clockFetch } from "@/lib/offline-clock-store";
import { STORE_TIMEZONE } from "@/lib/constants";
import { formatClock } from "@/lib/schedule";
import { formatStoreTime, getStoreToday } from "@/lib/store-time";

import { CORRECTION_LABELS, correctionTypes } from "@/lib/clock-corrections";
import { toStoreDateTimeLocal } from "@/lib/store-time";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

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

function syncedLabel(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function needsPhotoFor(sess) {
  if (!sess) return false;
  if (sess.action === "clock_out") return Boolean(sess.settings?.require_photo_on_clock_out);
  return Boolean(sess.settings?.require_face_on_clock_in);
}

function firstLetter(name) {
  const ch = String(name || "")
    .trim()
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(ch) ? ch : "#";
}

export default function ClockKiosk() {
  const [clock, setClock] = useState("");
  const [today, setToday] = useState("");
  const [step, setStep] = useState("list");
  const [employees, setEmployees] = useState([]);
  const [syncedAt, setSyncedAt] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);
  const [correction, setCorrection] = useState(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    createFaceDetector().catch(() => {});
    setClock(nowLabel());
    setToday(getStoreToday());
    const id = window.setInterval(() => setClock(nowLabel()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadRoster = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await clockFetch("/api/clock/roster");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load roster.");
      setEmployees(data.employees || []);
      window.dispatchEvent(new Event("clock-roster-updated"));
      setSyncedAt(data.synced_at || new Date().toISOString());
      if (!silent) setListError("");
    } catch (err) {
      setListError(err.message || "Could not load roster.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    if (step !== "list") return undefined;
    const id = window.setInterval(() => loadRoster({ silent: true }), 20000);
    return () => window.clearInterval(id);
  }, [step, loadRoster]);

  const reset = useCallback(() => {
    setStep("list");
    setSelected(null);
    setPin("");
    setManagerPin("");
    setError("");
    setLoading(false);
    setSession(null);
    setResult(null);
    setCorrection(null);
  }, []);

  const bounceToList = useCallback(
    (message) => {
      setListError(message || "Invalid PIN");
      reset();
    },
    [reset]
  );

  useEffect(() => {
    if (step !== "done" && step !== "correction_done") return undefined;
    const id = window.setTimeout(reset, 4000);
    return () => window.clearTimeout(id);
  }, [step, reset]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((emp) => String(emp.name || "").toLowerCase().includes(q));
  }, [employees, query]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const emp of filtered) {
      const letter = firstLetter(emp.name);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter).push(emp);
    }
    return [...map.entries()];
  }, [filtered]);

  const presentLetters = useMemo(() => new Set(grouped.map(([letter]) => letter)), [grouped]);

  const submitPunch = useCallback(
    async ({
      sess,
      pinValue,
      managerPinValue,
      photoBlob,
      faceDetected,
    }) => {
      const active = sess || session;
      const person = selected;
      if (!active || !person) return;
      setLoading(true);
      setError("");
      try {
        const form = new FormData();
        form.set("pin", pinValue ?? pin);
        form.set("employee_id", person.id);
        if (active.needsAuthorization) {
          form.set(
            "manager_pin",
            managerPinValue || (active.canSelfAuthorize ? pinValue ?? pin : managerPin)
          );
        }
        form.set("face_detected", faceDetected ? "true" : "false");
        if (photoBlob) form.set("file", photoBlob, "punch.jpg");
        const path = active.action === "clock_out" ? "/api/clock/out" : "/api/clock/in";
        const res = await clockFetch(path, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || "Could not save punch.");
          if (/end break/i.test(data.error || "")) setStep("actions");
          else if (needsPhotoFor(active)) setStep("photo");
          else if (active.action === "clock_out" && active.settings?.use_break_punches) {
            setStep("actions");
          } else if (active.needsAuthorization && !active.canSelfAuthorize) setStep("unscheduled");
          else setStep("actions");
          return;
        }
        setResult({
          action: active.action,
          name: active.employee?.name || person.name,
          clockIn: data.punch?.clock_in,
          workedMinutes: data.punch?.worked_minutes,
        });
        setStep("done");
        await loadRoster({ silent: true });
      } catch {
        setError("Could not save punch. Try again.");
        if (needsPhotoFor(active)) setStep("photo");
        else if (active.action === "clock_out" && active.settings?.use_break_punches) {
          setStep("actions");
        } else setStep("actions");
      } finally {
        setLoading(false);
      }
    },
    [session, selected, pin, managerPin, loadRoster]
  );

  const identifyingRef = useRef(false);

  const identify = useCallback(
    async (value, employee) => {
      if (value.length !== 4 || !employee || identifyingRef.current) return;
      identifyingRef.current = true;
      setLoading(true);
      setError("");
      try {
        const res = await clockFetch("/api/clock/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: value, employee_id: employee.id }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          bounceToList(data.error || "Invalid PIN");
          return;
        }
        setSession(data);
        setStep("actions");
      } catch {
        bounceToList("Could not reach the time clock. Try again.");
      } finally {
        identifyingRef.current = false;
        setLoading(false);
      }
    },
    [bounceToList]
  );

  useEffect(() => {
    if (step === "pin" && pin.length === 4 && selected) identify(pin, selected);
  }, [pin, step, selected, identify]);

  function continueAfterManagerPin() {
    if (managerPin.length !== 4) return;
    setError("");
    if (needsPhotoFor(session)) {
      setStep("photo");
      return;
    }
    submitPunch({
      sess: session,
      pinValue: pin,
      managerPinValue: managerPin,
      photoBlob: null,
      faceDetected: false,
    });
  }

  function beginPunch() {
    setError("");
    if (needsPhotoFor(session)) {
      setStep("photo");
      return;
    }
    submitPunch({
      sess: session,
      pinValue: pin,
      photoBlob: null,
      faceDetected: false,
    });
  }

  async function submitBreak(kind) {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const res = await clockFetch(kind === "end" ? "/api/clock/break/end" : "/api/clock/break/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, employee_id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not save break.");
        return;
      }
      setResult({
        action: kind === "end" ? "break_end" : "break_start",
        name: data.employee?.name || selected.name,
        breakStart: data.break?.break_start,
        breakEnd: data.break?.break_end,
        breakMinutes: data.break?.break_minutes,
      });
      setStep("done");
      await loadRoster({ silent: true });
    } catch {
      setError("Could not save break. Try again.");
    } finally {
      setLoading(false);
    }
  }


  async function submitCorrection(photoBlob, faceDetected) {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const form = new FormData();
      Object.entries({ ...correction, pin, employee_id: selected.id,
        punch_id: session.openPunch?.id || "", break_id: session.openBreak?.id || "" }).forEach(([key, value]) => form.set(key, value));
      form.set("file", photoBlob, "correction.jpg");
      form.set("face_detected", faceDetected ? "true" : "false");
      const res = await clockFetch("/api/clock/corrections", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || (res.status === 409 && /select your name again/i.test(data.error || ""))) { bounceToList(data.error); await loadRoster({ silent: true }); }
        else setError(data.error || "Could not save missed time.");
        return;
      }
      setResult(data); setPin(""); setStep("correction_done");
      await loadRoster({ silent: true });
    } catch { bounceToList("Connection interrupted. Select your name again to check your status before retrying."); }
    finally { setLoading(false); }
  }

  function jumpTo(letter) {
    const el = sectionRefs.current[letter];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function tapEmployee(emp) {
    setListError("");
    setSelected(emp);
    setPin("");
    setManagerPin("");
    setError("");
    setSession(null);
    setStep("pin");
  }

  const sheetOpen = step !== "list";
  const clockedIn = Boolean(session ? session.action === "clock_out" : selected?.clocked_in);
  const onBreak = Boolean(session ? session.on_break : selected?.on_break);

  return (
    <section className="relative flex h-dvh min-h-0 w-full flex-col overflow-hidden">
      <header className="shrink-0 px-4 pb-3 pt-5 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[#C8102E]">Arby&apos;s Hub</p>
        <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Time Clock</h1>
        <p className="mt-2 text-lg tabular-nums text-zinc-600 dark:text-zinc-300">{clock || "\u00a0"}</p>
        <p className="text-sm text-zinc-400">{today || "\u00a0"}</p>
        {syncedAt ? (
          <p className="mt-1 text-xs text-zinc-400">Synced at {syncedLabel(syncedAt)}</p>
        ) : null}
      </header>

      <div className="shrink-0 px-4 pb-3">
        <label className="sr-only" htmlFor="clock-search">
          Search employees
        </label>
        <input
          id="clock-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          autoComplete="off"
          className="h-14 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-lg dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {listError ? (
        <p className="px-4 pb-2 text-center text-sm font-medium text-red-600" role="alert">
          {listError}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pr-2">
          {loading && !employees.length ? (
            <p className="py-16 text-center text-base text-zinc-500">Loading roster…</p>
          ) : !filtered.length ? (
            <p className="py-16 text-center text-base text-zinc-500">No matching employees.</p>
          ) : (
            grouped.map(([letter, rows]) => (
              <div
                key={letter}
                ref={(node) => {
                  sectionRefs.current[letter] = node;
                }}
              >
                <p className="sticky top-0 z-10 bg-zinc-50/95 py-1 text-sm font-bold text-zinc-500 dark:bg-zinc-950/95">
                  {letter}
                </p>
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {rows.map((emp) => (
                    <li key={emp.id}>
                      <button
                        type="button"
                        onClick={() => tapEmployee(emp)}
                        className="flex min-h-20 w-full items-center gap-4 py-3 text-left"
                      >
                        <EmployeeAvatar name={emp.name} src={emp.profile_photo_url} size="lg" />
                        <span className="min-w-0 flex-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                          {emp.name}
                        </span>
                        <StatusPill clockedIn={emp.clocked_in} onBreak={emp.on_break} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
        <nav
          aria-label="Jump to letter"
          className="flex w-11 shrink-0 flex-col items-center justify-center gap-0 overflow-y-auto border-l border-zinc-200 bg-zinc-100/80 py-2 dark:border-zinc-800 dark:bg-zinc-900/80"
        >
          {presentLetters.has("#") ? (
            <button
              type="button"
              onClick={() => jumpTo("#")}
              className="min-h-5 text-[11px] font-bold text-[#C8102E]"
            >
              #
            </button>
          ) : null}
          {LETTERS.map((letter) => (
            <button
              key={letter}
              type="button"
              disabled={!presentLetters.has(letter)}
              onClick={() => jumpTo(letter)}
              className={`min-h-5 text-[11px] font-bold ${
                presentLetters.has(letter) ? "text-[#C8102E]" : "text-zinc-300 dark:text-zinc-700"
              }`}
            >
              {letter}
            </button>
          ))}
        </nav>
      </div>

      {sheetOpen ? (
        <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950">
          {step === "pin" && selected ? (
            <>
              <PunchHeader employee={selected} clockedIn={clockedIn} onBreak={onBreak} />
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
                subtitle="Confirms it's you"
              />
              <button
                type="button"
                className="mt-6 min-h-12 w-full rounded-2xl border border-zinc-300 text-base font-semibold dark:border-zinc-700"
                onClick={reset}
              >
                Cancel
              </button>
            </>
          ) : null}

          {step === "unscheduled" && selected ? (
            <>
              <PunchHeader employee={selected} clockedIn={false} />
              <p className="mt-4 text-center text-lg font-medium text-red-700" role="alert">
                {session?.message || "You're not scheduled today"}
              </p>
              {session?.shift ? (
                <p className="mt-2 text-center text-sm text-zinc-500">
                  Remaining window {formatClock(session.shift.scheduled_start)} –{" "}
                  {formatClock(session.shift.scheduled_end)}
                </p>
              ) : null}
              {error ? (
                <p className="mt-3 text-center text-base font-medium text-red-600" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setManagerPin("");
                  setError("");
                  setStep("manager_pin");
                }}
                className="mt-8 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40"
              >
                Manager authorize
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

          {step === "manager_pin" ? (
            <>
              <PunchHeader employee={selected} clockedIn={false} />
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
                onClick={continueAfterManagerPin}
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


          {step === "actions" && session ? (
            <>
              <PunchHeader employee={selected} clockedIn={clockedIn} onBreak={onBreak} />
              {error && <p role="alert" className="mt-4 text-center text-red-700">{error}</p>}
              {onBreak ? (
                <button disabled={loading} onClick={() => submitBreak("end")} className="mt-6 min-h-16 rounded-2xl bg-amber-500 text-xl font-bold text-white disabled:opacity-40">End Break</button>
              ) : (
                <>
                  {clockedIn && session.settings?.use_break_punches && <button disabled={loading} onClick={() => submitBreak("start")} className="mt-6 min-h-16 rounded-2xl bg-amber-500 text-xl font-bold text-white disabled:opacity-40">Start Break</button>}
                  <button disabled={loading} onClick={() => {
                    if (!clockedIn && session.needsAuthorization && !session.canSelfAuthorize) setStep("unscheduled");
                    else beginPunch();
                  }} className="mt-3 min-h-16 rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40">{clockedIn ? "Clock Out" : "Clock In"}</button>
                </>
              )}
              <p className="mt-8 text-center font-semibold">Missed a punch?</p>
              {correctionTypes(session).map(type => <button key={type} disabled={loading} onClick={() => {
                setCorrection({ type, claimed_time: toStoreDateTimeLocal(new Date().toISOString()).slice(0,16), reason: "" });
                setError(""); setStep("correction");
              }} className="mt-3 min-h-14 rounded-2xl border-2 border-[#C8102E] px-3 text-lg font-semibold text-[#C8102E] disabled:opacity-40">{CORRECTION_LABELS[type]}</button>)}
              <button disabled={loading} onClick={reset} className="mt-6 min-h-12 rounded-2xl border border-zinc-300 font-semibold">Cancel</button>
            </>
          ) : null}

          {step === "correction" && correction ? (
            <form onSubmit={event => { event.preventDefault(); setError(""); setStep("correction_photo"); }} className="mx-auto w-full max-w-lg">
              <PunchHeader employee={selected} clockedIn={clockedIn} onBreak={onBreak} />
              <h2 className="mt-5 text-center text-2xl font-bold">{CORRECTION_LABELS[correction.type]}</h2>
              <p className="mt-3 text-center">Your status updates immediately. A GM or assistant manager must review the corrected timecard.</p>
              <label className="mt-5 block font-semibold">Actual date and time (restaurant time)
                <input type="datetime-local" required value={correction.claimed_time} max={toStoreDateTimeLocal(new Date().toISOString()).slice(0,16)} onChange={e => setCorrection({ ...correction, claimed_time: e.target.value })} className="mt-2 min-h-14 w-full rounded-xl border border-zinc-300 p-3 dark:bg-zinc-900" />
              </label>
              <p className="mt-1 text-sm text-zinc-500">Up to 7 days ago. For older corrections, contact your manager.</p>
              <label className="mt-4 block font-semibold">What happened?
                <textarea required minLength={3} maxLength={1000} rows={3} value={correction.reason} onChange={e => setCorrection({ ...correction, reason: e.target.value })} className="mt-2 w-full rounded-xl border border-zinc-300 p-3 dark:bg-zinc-900" />
              </label>
              {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
              <button disabled={loading} className="mt-5 min-h-16 w-full rounded-2xl bg-[#C8102E] text-xl font-bold text-white disabled:opacity-40">Continue to photo</button>
              <button type="button" disabled={loading} onClick={() => { setStep("actions"); setError(""); }} className="mt-3 min-h-12 w-full rounded-2xl border border-zinc-300 font-semibold">Back</button>
            </form>
          ) : null}

          {step === "correction_photo" && correction ? (
            <>
              <PunchHeader employee={selected} clockedIn={clockedIn} onBreak={onBreak} />
              {error && <p role="alert" className="mt-3 text-center text-red-700">{error}</p>}
              <FaceCapture busy={loading} actionLabel="Capture & save missed time" onCaptured={submitCorrection}
                onCancel={() => { setError(""); setStep("correction"); }} />
            </>
          ) : null}

          {step === "correction_done" ? (
            <div className="m-auto text-center">
              <h2 className="text-3xl font-bold text-green-700">Missed time saved</h2>
              <p className="mt-4 text-xl">{result?.on_break ? "You are now on break." : result?.clocked_in ? "You are now clocked in and working." : "You are now clocked out."}</p>
              <p className="mt-3">Your timecard is flagged for manager review.</p>
              <button onClick={reset} className="mt-6 min-h-14 w-full rounded-2xl bg-[#C8102E] px-6 text-lg font-bold text-white">Done</button>
            </div>
          ) : null}

          {step === "photo" && session ? (
            <>
              <PunchHeader employee={selected || session.employee} clockedIn={clockedIn} />
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
                onCaptured={(blob, faceDetected = true) =>
                  submitPunch({
                    sess: session,
                    pinValue: pin,
                    managerPinValue: managerPin,
                    photoBlob: blob,
                    faceDetected: Boolean(faceDetected),
                  })
                }
                onCancel={() => {
                  if (session.action === "clock_out" && session.settings?.use_break_punches) {
                    setError("");
                    setStep("actions");
                    return;
                  }
                  reset();
                }}
              />
            </>
          ) : null}

          {step === "done" && result ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
                {result.action === "clock_out"
                  ? "Clocked out"
                  : result.action === "break_start"
                    ? "Break started"
                    : result.action === "break_end"
                      ? "Break ended"
                      : "Clocked in"}
              </p>
              <p className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                {result.action === "clock_out"
                  ? `Clocked out — ${formatWorkedHoursLabel(result.workedMinutes)}`
                  : result.action === "break_start"
                    ? `Break started at ${formatStoreTime(result.breakStart)}`
                    : result.action === "break_end"
                      ? `Break ended — ${Number(result.breakMinutes) || 0} min unpaid`
                      : `Clocked in at ${formatStoreTime(result.clockIn)}`}
              </p>
              {result.name ? <p className="mt-2 text-base text-zinc-500">{result.name}</p> : null}
              <button
                type="button"
                onClick={reset}
                className="mt-10 min-h-16 w-full max-w-md rounded-2xl bg-[#C8102E] text-xl font-bold text-white"
              >
                Done
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StatusPill({ clockedIn, onBreak }) {
  if (onBreak) {
    return (
      <span className="inline-flex shrink-0 min-w-[3.5rem] items-center justify-center rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">
        BREAK
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 min-w-[3.5rem] items-center justify-center rounded-full px-3 py-1 text-sm font-bold ${
        clockedIn
          ? "bg-emerald-100 text-emerald-800"
          : "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
      }`}
    >
      {clockedIn ? "IN" : "OUT"}
    </span>
  );
}

function PunchHeader({ employee, clockedIn, onBreak }) {
  if (!employee) return null;
  return (
    <div className="mb-4 flex flex-col items-center text-center">
      <EmployeeAvatar name={employee.name} src={employee.profile_photo_url} size="xl" />
      <p className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{employee.name}</p>
      <div className="mt-2">
        <StatusPill clockedIn={clockedIn} onBreak={onBreak} />
      </div>
    </div>
  );
}
