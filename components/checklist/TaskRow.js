"use client";

import { useEffect, useRef, useState } from "react";
import { hasCompletionImage, isCaptureMethod, isSignatureMethod } from "@/lib/checklist";
import { formatStoreTime } from "@/lib/store-time";

function CheckboxIcon({ checked }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 text-lg ${
        checked
          ? "border-green-600 bg-green-50 text-green-700 dark:bg-green-950"
          : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
      }`}
      aria-hidden="true"
    >
      {checked ? "✓" : ""}
    </span>
  );
}

function CameraIcon({ done }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 text-xl ${
        done
          ? "border-green-600 bg-green-50 dark:bg-green-950"
          : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
      }`}
      aria-hidden="true"
    >
      📷
    </span>
  );
}

function SignatureIcon({ done }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 ${
        done
          ? "border-green-600 bg-green-50 text-[#C8102E] dark:bg-green-950"
          : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
      }`}
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    </span>
  );
}

export default function TaskRow({
  row,
  completionDate,
  onComplete,
  onUncomplete,
  onPhoto,
  onSaveNote,
  busy = false,
}) {
  const fileRef = useRef(null);
  const { task, completion, completionShift } = row;
  const done = Boolean(completion);
  const captureTask = isCaptureMethod(task.verification_method);
  const signatureTask = isSignatureMethod(task.verification_method);

  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);

  useEffect(() => {
    if (noteOpen && done) {
      setDraftNote(completion?.notes != null && completion.notes !== "" ? String(completion.notes) : "");
    }
  }, [noteOpen, done, completion?.id, completion?.notes]);

  async function handleCheckboxClick() {
    if (busy || savingNote) return;
    if (done) {
      const ok = window.confirm("Mark as incomplete?");
      if (!ok) return;
      await onUncomplete({
        completion_id: completion.id,
        task_id: task.id,
        shift: completionShift,
        completion_date: completionDate,
      });
      return;
    }
    const notes = draftNote.trim() || undefined;
    await onComplete({
      task_id: task.id,
      shift: completionShift,
      completion_date: completionDate,
      notes,
    });
    setDraftNote("");
  }

  async function handleCaptureSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy || savingNote) return;
    if (done) {
      const ok = window.confirm(
        signatureTask ? "Mark as incomplete and upload a new signature?" : "Mark as incomplete and retake photo?"
      );
      if (!ok) return;
      await onUncomplete({
        completion_id: completion.id,
        task_id: task.id,
        shift: completionShift,
        completion_date: completionDate,
      });
    }
    const notes = draftNote.trim() || undefined;
    await onPhoto({
      task_id: task.id,
      shift: completionShift,
      completion_date: completionDate,
      file,
      notes,
    });
    setDraftNote("");
  }

  async function handleSaveNoteClick() {
    if (!done || !completion?.id || !onSaveNote) return;
    setSavingNote(true);
    try {
      await onSaveNote({ completion_id: completion.id, notes: draftNote });
    } finally {
      setSavingNote(false);
    }
  }

  const notePreview = completion?.notes ? String(completion.notes).trim() : "";
  const showImage = done && hasCompletionImage(completion);

  return (
    <li className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        {captureTask ? (
          <>
            <button
              type="button"
              disabled={busy || savingNote}
              onClick={() => fileRef.current?.click()}
              className="shrink-0 disabled:opacity-50"
              aria-label={
                done
                  ? `${signatureTask ? "Signature" : "Photo"} completed for ${task.title}`
                  : `${signatureTask ? "Upload signature" : "Take photo"} for ${task.title}`
              }
            >
              {signatureTask ? <SignatureIcon done={done} /> : <CameraIcon done={done} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleCaptureSelected}
            />
          </>
        ) : (
          <button
            type="button"
            disabled={busy || savingNote}
            onClick={handleCheckboxClick}
            className="shrink-0 disabled:opacity-50"
            aria-label={done ? `Uncheck ${task.title}` : `Complete ${task.title}`}
          >
            <CheckboxIcon checked={done} />
          </button>
        )}

        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`min-w-0 font-medium ${done ? "text-zinc-400 line-through" : ""}`}>{task.title}</p>
            <button
              type="button"
              onClick={() => setNoteOpen((o) => !o)}
              className="shrink-0 text-xs font-semibold text-[#C8102E] hover:underline"
            >
              {noteOpen ? "Hide note" : "+ note"}
            </button>
          </div>
          {task.description ? (
            <p className="mt-0.5 text-xs text-zinc-500">{task.description}</p>
          ) : null}
          {done && completion ? (
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              ✓ {completion.completed_by_name} at {formatStoreTime(completion.completed_at)}
            </p>
          ) : null}
          {showImage ? (
            <button
              type="button"
              onClick={() => setImageOpen(true)}
              className="mt-2 block"
            >
              <img
                src={completion.photo_url}
                alt={signatureTask ? "Signature" : "Completion photo"}
                className="h-14 w-14 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
              />
            </button>
          ) : null}
          {done && notePreview ? (
            <p className="mt-1 whitespace-pre-wrap text-xs italic text-zinc-600 dark:text-zinc-400">
              &ldquo;{notePreview}&rdquo;
            </p>
          ) : null}
          {noteOpen ? (
            <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
              <textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Optional note…"
                className="w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
              />
              {!done ? (
                <p className="text-xs text-zinc-500">
                  Saved when you complete this task (checkbox, photo, or signature).
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savingNote || busy}
                    onClick={handleSaveNoteClick}
                    className="rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {savingNote ? "Saving…" : "Save note"}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {imageOpen && completion?.photo_url ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setImageOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={completion.photo_url}
            alt={signatureTask ? "Signature" : "Completion photo"}
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      ) : null}
    </li>
  );
}
