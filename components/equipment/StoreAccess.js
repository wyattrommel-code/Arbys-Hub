"use client";

import { useEffect, useState } from "react";
import { EquipmentDialog, EquipmentError, equipmentRequest } from "./EquipmentUI";
import styles from "./Equipment.module.css";

export default function StoreAccess({ store, onClose }) {
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ employee_id: "", role: "crew", is_active: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { equipmentRequest("/api/stores/members").then((result) => setPeople(result.people)).catch((error) => setError(error.message)); }, []);
  function select(id) {
    const person = people.find((person) => person.employee_id === id);
    setForm({ employee_id: id, role: person?.role || "crew", is_active: person?.role ? person.is_active : true }); setNotice("");
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await equipmentRequest("/api/stores/members", { method: "POST", body: JSON.stringify(form) }); setPeople(result.people); setNotice("Store access saved."); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <EquipmentDialog title={`Store access · ${store.name}`} onClose={onClose} busy={busy}><form onSubmit={save}><fieldset className={styles.fields} disabled={busy}>
    <p className={styles.hint}>Manage access to this store&apos;s library, equipment, and checklists. Team members must already have an active employee account in your organization.</p>
    <label className={styles.field}>Team member<select required value={form.employee_id} onChange={(event) => select(event.target.value)}><option value="">Choose a team member</option>{people.map((person) => <option key={person.employee_id} value={person.employee_id}>{person.name} · {person.home_store}</option>)}</select></label>
    <label className={styles.field}>Store role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="crew">Crew</option><option value="shift_lead">Shift lead</option><option value="assistant_manager">Assistant manager</option><option value="gm">GM</option></select></label>
    <label className={styles.checkbox}><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />Access enabled</label>
    {notice ? <p role="status" className={styles.completionText}>{notice}</p> : null}
    <div className={styles.hint}><strong>Currently enabled</strong>{people.filter((person) => person.is_active && person.role).map((person) => <p key={person.employee_id}>{person.name} · {person.role.replaceAll("_", " ")}</p>)}</div>
  </fieldset><EquipmentError>{error}</EquipmentError><footer className={styles.formFooter}><button type="button" className={styles.secondary} onClick={onClose} disabled={busy}>Close</button><button className={styles.primary} disabled={busy || !form.employee_id}>{busy ? "Saving…" : "Save access"}</button></footer></form></EquipmentDialog>;
}
