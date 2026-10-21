"use client";

import { useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { DUTY_ROLES, MAX_MANUAL_BYTES, storeToday } from "@/lib/equipment";
import { uploadEquipmentManual } from "@/lib/equipment-upload";
import { EquipmentDialog, EquipmentError, equipmentRequest } from "./EquipmentUI";
import styles from "./Equipment.module.css";

const EMPTY_EQUIPMENT = { name: "", manufacturer: "", model: "", serial_number: "", location: "", notes: "", service_contact: "", status: "active" };

function FormFooter({ onClose, busy, label }) {
  return <footer className={styles.formFooter}><button type="button" className={styles.secondary} disabled={busy} onClick={onClose}>Cancel</button><button className={styles.primary} disabled={busy}><Check size={16} />{busy ? "Saving…" : label}</button></footer>;
}

export function EquipmentForm({ equipment, onClose, onSaved }) {
  const [form, setForm] = useState(equipment || EMPTY_EQUIPMENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await equipmentRequest(equipment ? `/api/equipment/${equipment.id}` : "/api/equipment", { method: equipment ? "PUT" : "POST", body: JSON.stringify(form) });
      onSaved(result.equipment);
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <EquipmentDialog title={equipment ? "Edit equipment" : "Add equipment"} onClose={onClose} busy={busy}>
    <form onSubmit={save}><fieldset className={styles.fields} disabled={busy}>
      <label className={styles.field}>Equipment name<input autoFocus name="name" required maxLength={120} value={form.name} onChange={change} placeholder="e.g. Slicer #1" /></label>
      <div className={styles.columns}><label className={styles.field}>Manufacturer<input name="manufacturer" value={form.manufacturer} maxLength={120} onChange={change} /></label><label className={styles.field}>Model<input name="model" value={form.model} maxLength={120} onChange={change} /></label></div>
      <div className={styles.columns}><label className={styles.field}>Serial number (optional)<input name="serial_number" value={form.serial_number} maxLength={120} onChange={change} /></label><label className={styles.field}>Location<input name="location" value={form.location} maxLength={120} onChange={change} placeholder="e.g. Prep area" /></label></div>
      <label className={styles.field}>Status<select name="status" value={form.status} onChange={change}><option value="active">In service</option><option value="out_of_service">Out of service</option><option value="retired">Retired</option></select></label>
      <p className={styles.hint}>Out-of-service and retired equipment stop generating due work. Manuals and completed history are retained.</p>
      <label className={styles.field}>Service contact<input name="service_contact" value={form.service_contact} maxLength={500} onChange={change} placeholder="Company, phone, or support details" /></label>
      <label className={styles.field}>Notes<textarea name="notes" value={form.notes} rows={4} maxLength={10000} onChange={change} /></label>
    </fieldset><EquipmentError>{error}</EquipmentError><FormFooter busy={busy} onClose={onClose} label={equipment ? "Save equipment" : "Add equipment"} /></form>
  </EquipmentDialog>;
}

export function ScheduleForm({ equipment, schedule, kind, timezone, onClose, onSaved }) {
  const [form, setForm] = useState(schedule || { title: "", instructions: "", kind, frequency_interval: 1, frequency_unit: "days", start_date: storeToday(timezone), shift: "PM", responsible_role: "crew", is_active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(event) { const { name, value, checked, type } = event.target; setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : name === "frequency_interval" ? Number(value) : value })); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await equipmentRequest(`/api/equipment/${equipment.id}/schedules${schedule ? `/${schedule.id}` : ""}`, { method: schedule ? "PUT" : "POST", body: JSON.stringify(form) });
      onSaved();
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <EquipmentDialog title={`${schedule ? "Edit" : "Add"} ${form.kind === "cleaning" ? "cleaning" : "maintenance"} schedule`} onClose={onClose} busy={busy}>
    <form onSubmit={save}><fieldset className={styles.fields} disabled={busy}>
      <p className={styles.hint}>{equipment.name} · Due work appears automatically in Checklists.</p>
      <label className={styles.field}>Task name<input autoFocus name="title" value={form.title} onChange={change} required maxLength={160} placeholder="Name the cleaning or service task" /></label>
      <label className={styles.field}>Instructions<textarea name="instructions" value={form.instructions} rows={5} maxLength={30000} onChange={change} placeholder="Add approved instructions or reference the attached manual." /></label>
      <div className={styles.columns}><label className={styles.field}>Repeat every<input name="frequency_interval" type="number" min={1} max={365} required value={form.frequency_interval} onChange={change} /></label><label className={styles.field}>Interval<select name="frequency_unit" value={form.frequency_unit} onChange={change}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label></div>
      <div className={styles.columns}><label className={styles.field}>First due date<input name="start_date" type="date" required value={form.start_date} onChange={change} /></label><label className={styles.field}>Shift<select name="shift" value={form.shift} onChange={change}><option>AM</option><option>PM</option></select></label></div>
      <p className={styles.hint}>Weekly schedules repeat on the first due date&apos;s weekday. Monthly schedules use that date, or the last day of a shorter month.</p>
      <label className={styles.field}>Responsible role<select name="responsible_role" value={form.responsible_role} onChange={change}>{DUTY_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
      <label className={styles.checkbox}><input name="is_active" type="checkbox" checked={form.is_active} onChange={change} />Schedule active</label>
      {schedule ? <p className={styles.hint}>Edits apply to upcoming work. Completed records keep their original instructions. Pausing cancels outstanding tasks without deleting history.</p> : null}
    </fieldset><EquipmentError>{error}</EquipmentError><FormFooter busy={busy} onClose={onClose} label="Save schedule" /></form>
  </EquipmentDialog>;
}

export function ManualForm({ equipment, onClose, onSaved }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  async function save(event) {
    event.preventDefault(); setError("");
    if (!file || !/\.pdf$/i.test(file.name) || file.size > MAX_MANUAL_BYTES) { setError("Choose a PDF of 50 MB or smaller."); return; }
    setBusy(true);
    let ticket;
    try {
      if (await file.slice(0, 5).text() !== "%PDF-") throw new Error("This file does not appear to be a PDF. Choose the original PDF manual.");
      ticket = await equipmentRequest(`/api/equipment/${equipment.id}/manuals`, { method: "POST", body: JSON.stringify({ title, file_name: file.name, file_size: file.size }) });
      await uploadEquipmentManual(ticket, file);
      await equipmentRequest(`/api/equipment/${equipment.id}/manuals/${ticket.id}`, { method: "PATCH" });
      onSaved();
    } catch (error) {
      setError(error.message || "Could not upload this PDF.");
      if (ticket?.id) await equipmentRequest(`/api/equipment/${equipment.id}/manuals/${ticket.id}`, { method: "DELETE" }).catch(() => {});
    } finally { setBusy(false); }
  }
  return <EquipmentDialog title="Upload PDF manual" onClose={onClose} busy={busy}>
    <form onSubmit={save}><fieldset className={styles.fields} disabled={busy}>
      <label className={styles.field}>Document title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} placeholder="e.g. Operating manual" /></label>
      <label className={styles.upload}><Upload size={25} /><span>Choose a PDF manual</span><input ref={fileRef} type="file" accept=".pdf,application/pdf" required onChange={(event) => { const selected = event.target.files?.[0] || null; setFile(selected); if (selected && !title) setTitle(selected.name.replace(/\.pdf$/i, "")); }} /></label>
      <p className={styles.hint}>Up to 50 MB per PDF. You can attach multiple manuals to {equipment.name}. Files are private to authorized store users.</p>
    </fieldset><EquipmentError>{error}</EquipmentError><FormFooter busy={busy} onClose={onClose} label={busy ? "Uploading…" : "Upload manual"} /></form>
  </EquipmentDialog>;
}
