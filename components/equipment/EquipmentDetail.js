"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Pencil, Plus, Wrench } from "lucide-react";
import { DUTY_ROLES, scheduleLabel } from "@/lib/equipment";
import { formatResourceSize } from "@/lib/resources";
import { EquipmentForm, ManualForm, ScheduleForm } from "./EquipmentForms";
import { EquipmentDate, EquipmentError, equipmentRequest } from "./EquipmentUI";
import StoreSwitcher from "./StoreSwitcher";
import styles from "./Equipment.module.css";

const PANELS = ["Details", "Manuals", "Cleaning", "Maintenance", "History"];

export default function EquipmentDetail({ id }) {
  const [data, setData] = useState(null);
  const [panel, setPanel] = useState("Details");
  const [modal, setModal] = useState(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const result = await equipmentRequest(`/api/equipment/${id}`); setData(result); setError(""); }
    catch (error) { setError(error.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  function saved() { setModal(null); load(); }
  async function removeManual(manual) {
    setBusy(true); setError("");
    try { await equipmentRequest(`/api/equipment/${id}/manuals/${manual.id}`, { method: "DELETE" }); setRemoving(null); await load(); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function moreHistory() {
    setBusy(true); setError("");
    try { const result = await equipmentRequest(`/api/equipment/${id}/history?offset=${data.history.length}`); setData((current) => ({ ...current, history: [...current.history, ...result.history], has_more: result.has_more })); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <div className={styles.workspace}><StoreSwitcher /><Link href="/database/equipment" className={styles.backLink}>← Equipment</Link><EquipmentError>{error}</EquipmentError>
    {!data ? <div className={styles.empty}>{error ? <button className={styles.secondary} onClick={load}>Try again</button> : <p role="status">Loading equipment…</p>}</div> : <>
      <header className={styles.pageHeading}><div><p className={styles.eyebrow}>{data.store.name.toUpperCase()} · EQUIPMENT</p><h2>{data.equipment.name}</h2><p>{[data.equipment.manufacturer, data.equipment.model, data.equipment.location].filter(Boolean).join(" · ")}</p></div><div className={styles.headingActions}><span className={styles.pill}>{data.equipment.status === "active" ? "In service" : data.equipment.status.replaceAll("_", " ")}</span>{data.can_manage ? <button className={styles.secondary} onClick={() => setModal({ type: "equipment" })}><Pencil size={16} />Edit equipment</button> : null}</div></header>
      <nav className={styles.panelNav} aria-label="Equipment sections">{PANELS.map((name) => <button key={name} aria-pressed={panel === name} className={panel === name ? styles.selectedPanel : ""} onClick={() => { setPanel(name); setRemoving(null); }}>{name}{name === "Manuals" ? ` (${data.manuals.length})` : ""}</button>)}</nav>
      <section className={styles.panel} aria-label={`${panel} for ${data.equipment.name}`}>
        {panel === "Details" ? <><dl className={styles.detailsGrid}>{[["Manufacturer", data.equipment.manufacturer], ["Model", data.equipment.model], ["Serial number", data.equipment.serial_number], ["Location", data.equipment.location], ["Service contact", data.equipment.service_contact]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not added"}</dd></div>)}</dl>{data.equipment.notes ? <div className={styles.instructions}><h3>Notes</h3><p>{data.equipment.notes}</p></div> : null}<div className={styles.infoLine}><Wrench size={18} /><p>Add approved cleaning and maintenance schedules here. Due work appears in <Link href="/checklist">Checklists</Link>.</p></div></> : null}
        {panel === "Manuals" ? <><div className={styles.sectionHeading}><div><h3>PDF manuals</h3><p>Operating instructions, service manuals, and reference documents.</p></div>{data.can_manage ? <button className={styles.primary} onClick={() => setModal({ type: "manual" })}><Plus size={16} />Upload PDF</button> : null}</div>{!data.manuals.length ? <p className={styles.empty}>No manuals have been added to this equipment yet.</p> : <div className={styles.documentList}>{data.manuals.map((manual) => <div key={manual.id} className={styles.documentRow}><FileText size={23} /><div><strong>{manual.title}</strong><p>{manual.file_name} · {formatResourceSize(manual.file_size)}</p></div><a href={`/api/equipment/${id}/manuals/${manual.id}/file`} target="_blank" rel="noopener noreferrer" aria-label={`Download ${manual.title}`} className={styles.secondary}><Download size={17} /><span className={styles.downloadLabel}>Download</span></a>{data.can_manage ? <button className={styles.textButton} disabled={busy} onClick={() => setRemoving(manual)}>Remove</button> : null}</div>)}</div>}{removing ? <div className={styles.confirmation}><p>Remove “{removing.title}” from this equipment&apos;s manuals?</p><button className={styles.secondary} disabled={busy} onClick={() => setRemoving(null)}>Keep manual</button><button className={styles.primary} disabled={busy} onClick={() => removeManual(removing)}>Remove manual</button></div> : null}</> : null}
        {["Cleaning", "Maintenance"].includes(panel) ? <><div className={styles.sectionHeading}><div><h3>{panel} schedules</h3><p>Tasks repeat from their first due date and feed the store&apos;s checklists.</p></div>{data.can_manage ? <button className={styles.primary} onClick={() => setModal({ type: "schedule", kind: panel.toLowerCase() })}><Plus size={16} />Add schedule</button> : null}</div>{!data.schedules.some((schedule) => schedule.kind === panel.toLowerCase()) ? <p className={styles.empty}>No {panel.toLowerCase()} schedules yet. Add the tasks and intervals approved for this equipment.</p> : <div className={styles.scheduleList}>{data.schedules.filter((schedule) => schedule.kind === panel.toLowerCase()).map((schedule) => <article key={schedule.id} className={styles.scheduleCard}><header><h4>{schedule.title}</h4><span className={styles.pill}>{schedule.is_active ? "Active" : "Paused"}</span></header><p className={styles.scheduleFrequency}>{scheduleLabel(schedule)}</p><p className={styles.hint}>First due <EquipmentDate value={schedule.start_date} /> · {DUTY_ROLES.find((role) => role.value === schedule.responsible_role)?.label}</p>{schedule.instructions ? <p className={styles.instructionsText}>{schedule.instructions}</p> : null}{data.can_manage ? <button className={styles.textButton} onClick={() => setModal({ type: "schedule", kind: schedule.kind, schedule })}><Pencil size={14} />Edit schedule</button> : null}</article>)}</div>}<Link className={styles.backLink} href="/checklist">Open due work in Checklists →</Link></> : null}
        {panel === "History" ? <><div className={styles.sectionHeading}><div><h3>Task history</h3><p>Completed work retains the equipment name and instructions from when it was due.</p></div></div>{!data.history.length ? <p className={styles.empty}>History will appear as scheduled work becomes due.</p> : <ol className={styles.historyList}>{data.history.map((task) => <li key={task.id}><div className={styles.historyHeading}><strong>{task.title}</strong><span className={`${styles.pill} ${task.status === "completed" ? styles.complete : ""}`}>{task.status}</span></div><p className={styles.hint}>{task.kind} · Due <EquipmentDate value={task.due_date} /> · {task.shift}</p>{task.completed_at ? <p className={styles.completionText}>{task.completed_by_name} · <EquipmentDate value={task.completed_at} timezone={data.store.timezone} time /></p> : null}{task.notes ? <p className={styles.instructionsText}>{task.notes}</p> : null}{task.instructions ? <details><summary>Instructions at the time</summary><p className={styles.instructionsText}>{task.instructions}</p></details> : null}</li>)}</ol>}{data.has_more ? <button className={styles.secondary} disabled={busy} onClick={moreHistory}>Load more history</button> : null}</> : null}
      </section>
      {modal?.type === "equipment" ? <EquipmentForm equipment={data.equipment} onClose={() => setModal(null)} onSaved={saved} /> : null}
      {modal?.type === "manual" ? <ManualForm equipment={data.equipment} onClose={() => setModal(null)} onSaved={saved} /> : null}
      {modal?.type === "schedule" ? <ScheduleForm equipment={data.equipment} schedule={modal.schedule} kind={modal.kind} timezone={data.store.timezone} onClose={() => setModal(null)} onSaved={saved} /> : null}
    </>}
  </div>;
}
