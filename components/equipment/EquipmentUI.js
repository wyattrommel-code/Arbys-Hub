"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import styles from "./Equipment.module.css";

export async function equipmentRequest(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  if (response.redirected && new URL(response.url).pathname === "/login") throw new Error("Your session ended. Please sign in again.");
  let result;
  try { result = await response.json(); } catch { throw new Error("Could not complete the request. Reload the page and try again."); }
  if (!response.ok) throw new Error(result.error || "Could not complete the request.");
  return result;
}

export function EquipmentDialog({ title, busy, children, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{title}</h2><button type="button" className={styles.iconButton} aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    {children}
  </dialog>;
}

export function EquipmentError({ children }) { return children ? <p className={styles.error} role="alert">{children}</p> : null; }

export function EquipmentDate({ value, timezone, time = false }) {
  if (!value) return null;
  return <time dateTime={value}>{new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleString("en-US", value.length === 10 ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", year: "numeric", ...(time ? { hour: "numeric", minute: "2-digit" } : {}), timeZone: timezone || "America/Denver" })}</time>;
}
