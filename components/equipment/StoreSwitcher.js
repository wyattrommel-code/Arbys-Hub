"use client";

import { useEffect, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { EquipmentDialog, EquipmentError, equipmentRequest } from "./EquipmentUI";
import styles from "./Equipment.module.css";
import StoreAccess from "./StoreAccess";

export default function StoreSwitcher() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", number: "", timezone: "America/Denver" });
  useEffect(() => { equipmentRequest("/api/stores").then(setData).catch((error) => setError(error.message)); }, []);
  async function switchStore(id) {
    setBusy(true); setError("");
    try {
      await equipmentRequest("/api/stores/select", { method: "POST", body: JSON.stringify({ store_id: id }) });
      // A store change must discard all cached client data from the previous store.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/database");
    }
    catch (error) { setError(error.message); setBusy(false); }
  }
  async function create(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await equipmentRequest("/api/stores", { method: "POST", body: JSON.stringify(form) }); await switchStore(result.store.id); }
    catch (error) { setError(error.message); setBusy(false); }
  }
  return <div className={styles.storeArea}>
    <div className={styles.storeBar}><Building2 size={17} aria-hidden="true" />{data ? <label>Store<select aria-label="Current store" value={data.store.id} disabled={busy} onChange={(event) => switchStore(event.target.value)}>{data.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.number ? ` · ${store.number}` : ""}</option>)}</select></label> : <span>Loading store access…</span>}
      {data && (data.store.role === "gm" || data.store.can_create_store) ? <button className={styles.textButton} type="button" disabled={busy} onClick={() => setAccessOpen(true)}>Store access</button> : null}
      {data?.store.can_create_store ? <button className={styles.textButton} type="button" disabled={busy} onClick={() => { setOpen(true); setError(""); }}><Plus size={15} />Add store</button> : null}
    </div>
    {!open && error ? <p role="alert" className={styles.inlineError}>{error}</p> : null}
    {accessOpen ? <StoreAccess store={data.store} onClose={() => setAccessOpen(false)} /> : null}
    {open ? <EquipmentDialog title="Add store" busy={busy} onClose={() => setOpen(false)}><form onSubmit={create}><fieldset className={styles.fields} disabled={busy}>
      <p className={styles.hint}>The new store gets its own six library tabs and an empty equipment list. You receive manager access to set it up.</p>
      <label className={styles.field}>Store name<input autoFocus required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Nephi" /></label>
      <label className={styles.field}>Store number (optional)<input maxLength={30} value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label>
      <label className={styles.field}>Time zone<select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>{["America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Chicago", "America/New_York", "America/Anchorage", "Pacific/Honolulu"].map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select></label>
    </fieldset><EquipmentError>{error}</EquipmentError><footer className={styles.formFooter}><button className={styles.secondary} type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className={styles.primary} disabled={busy}>{busy ? "Creating…" : "Create store"}</button></footer></form></EquipmentDialog> : null}
  </div>;
}
