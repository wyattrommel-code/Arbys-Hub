"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Wrench } from "lucide-react";
import { DUTY_ROLES } from "@/lib/equipment";
import { EquipmentDate, equipmentRequest } from "./EquipmentUI";
import styles from "./Equipment.module.css";

export default function EquipmentChecklist({ fullDay = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});
  const [noteOpen, setNoteOpen] = useState(null);
  const load = useCallback(async () => {
    try { const result = await equipmentRequest("/api/equipment/due"); setData(result); setError(""); }
    catch (error) { setError(error.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function complete(task) {
    setBusy(task.id); setError("");
    try { await equipmentRequest(`/api/equipment/tasks/${task.id}`, { method: "POST", body: JSON.stringify({ notes: notes[task.id] || "" }) }); setNoteOpen(null); await load(); }
    catch (error) { setError(error.message); } finally { setBusy(null); }
  }
  const tasks = fullDay ? data?.tasks || [] : (data?.tasks || []).slice(0, 5);
  const done = data?.tasks.filter((task) => task.status === "completed").length || 0;
  return <section className={`${styles.checklist} ${styles.workspace}`} aria-label="Equipment cleaning and maintenance">
    <header className={styles.sectionHeading}><div><h3><Wrench size={18} />Equipment work</h3><p>{data ? `${done} of ${data.tasks.length} complete · ${data.store.name}` : "Cleaning and maintenance"}</p></div><Link href={fullDay ? "/database/equipment" : "/checklist"} className={styles.textButton}>{fullDay ? "Equipment & schedules" : "View all"} →</Link></header>
    {error ? <div role="alert" className={styles.inlineError}>{error}<button className={styles.textButton} onClick={load}>Try again</button></div> : !data ? <p role="status" className={styles.hint}>Loading equipment work…</p> : !tasks.length ? <p className={styles.hint}>No equipment work due. Managers can add schedules in Database → Equipment.</p> : <ul className={styles.taskList}>{tasks.map((task) => <li key={task.id}>
      <div className={styles.taskTop}>{task.status === "completed" ? <span className={styles.checked} aria-label={`${task.title} completed`}><Check size={22} /></span> : <button type="button" className={styles.taskCheck} aria-label={`Complete ${task.title} for ${task.equipment_name}`} onClick={() => complete(task)} disabled={!task.can_complete || busy !== null}>{busy === task.id ? "…" : ""}</button>}
        <div className={styles.taskContent}><div className={styles.taskTitle}><strong>{task.title}</strong><span className={task.overdue && task.status !== "completed" ? styles.due : styles.hint}>{task.shift}{task.overdue && task.status !== "completed" ? " · Overdue" : ""}</span></div><Link className={styles.equipmentLink} href={`/database/equipment/${task.equipment_id}`}>{task.equipment_name}</Link><p className={styles.hint}>{task.kind} · Due <EquipmentDate value={task.due_date} /> · {DUTY_ROLES.find((role) => role.value === task.responsible_role)?.label}</p>{task.instructions ? <p className={styles.taskInstructions}>{task.instructions}</p> : null}
          {task.status === "completed" ? <p className={styles.completionText}>{task.completed_by_name} · <EquipmentDate value={task.completed_at} timezone={data.store.timezone} time />{task.notes ? ` · ${task.notes}` : ""}</p> : <><button className={styles.textButton} type="button" onClick={() => setNoteOpen(noteOpen === task.id ? null : task.id)} disabled={busy !== null}>{noteOpen === task.id ? "Hide note" : "+ Completion note"}</button>{noteOpen === task.id ? <label className={styles.field}><span className={styles.srOnly}>Completion note for {task.title}</span><textarea aria-label={`Completion note for ${task.title}`} rows={2} value={notes[task.id] || ""} maxLength={10000} onChange={(event) => setNotes({ ...notes, [task.id]: event.target.value })} /></label> : null}</>}
        </div>
      </div>
    </li>)}</ul>}
  </section>;
}
