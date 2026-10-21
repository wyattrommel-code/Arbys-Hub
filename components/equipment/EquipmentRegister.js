"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Plus, Search, Wrench } from "lucide-react";
import { EquipmentForm } from "./EquipmentForms";
import { EquipmentError, equipmentRequest } from "./EquipmentUI";
import StoreSwitcher from "./StoreSwitcher";
import styles from "./Equipment.module.css";

export default function EquipmentRegister({ embedded = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("current");
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  function load() { setRevision((value) => value + 1); }
  useEffect(() => {
    let cancelled = false;
    equipmentRequest("/api/equipment").then((result) => { if (!cancelled) { setData(result); setError(""); } }).catch((error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [revision]);
  const equipment = useMemo(() => (data?.equipment || []).filter((item) => (status === "all" || (status === "current" ? item.status !== "retired" : item.status === status)) && [item.name, item.manufacturer, item.model, item.serial_number, item.location].join(" ").toLowerCase().includes(search.trim().toLowerCase())), [data, search, status]);
  return <section className={`${styles.workspace} ${embedded ? styles.embedded : ""}`} aria-label="Equipment register">
    {!embedded ? <><StoreSwitcher /><Link href="/database" className={styles.backLink}>← Database</Link></> : null}
    <header className={styles.pageHeading}><div><p className={styles.eyebrow}>STORE EQUIPMENT</p><h2>{embedded ? "Equipment register" : "Equipment"}</h2><p>Machines, PDF manuals, cleaning, and maintenance for {data?.store.name || "this store"}.</p></div>{data?.can_manage ? <button className={styles.primary} onClick={() => setAdding(true)}><Plus size={17} />Add equipment</button> : null}</header>
    <div className={styles.listToolbar}><label className={styles.search}><Search size={17} /><span className={styles.srOnly}>Search equipment</span><input type="search" aria-label="Search equipment" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, model, or location…" /></label><select aria-label="Equipment status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="current">Current equipment</option><option value="out_of_service">Out of service</option><option value="retired">Retired</option><option value="all">All equipment</option></select></div>
    <EquipmentError>{error}</EquipmentError>
    {!data && !error ? <p role="status" className={styles.empty}>Loading equipment…</p> : null}
    {error ? <button className={styles.secondary} onClick={load}>Try again</button> : data && !equipment.length ? <div className={styles.empty}><Wrench size={32} /><h3>{search || status !== "current" ? "No matching equipment" : "Add this store's equipment"}</h3><p>{search || status !== "current" ? "Try a different search or status." : data.can_manage ? "Start with a name and model. You can add manuals and schedules next." : "Equipment will appear here when a manager adds it."}</p>{data.can_manage && !search && status === "current" ? <button className={styles.primary} onClick={() => setAdding(true)}><Plus size={16} />Add first equipment</button> : null}</div> : <div className={styles.equipmentGrid}>{equipment.map((item) => <Link key={item.id} href={`/database/equipment/${item.id}`} className={styles.equipmentCard}><div className={styles.cardTop}><span className={styles.assetIcon}><Wrench size={22} /></span><ArrowUpRight size={17} /></div><h3>{item.name}</h3><p>{[item.manufacturer, item.model].filter(Boolean).join(" · ") || "Model not added"}</p>{item.location ? <p className={styles.hint}>{item.location}</p> : null}<footer><span className={`${styles.pill} ${item.status === "out_of_service" ? styles.warning : ""}`}>{item.status.replaceAll("_", " ") === "active" ? "In service" : item.status.replaceAll("_", " ")}</span>{item.due_count ? <span className={styles.due}>{item.due_count} due</span> : <span className={styles.hint}>No outstanding work</span>}</footer></Link>)}</div>}
    {adding ? <EquipmentForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
  </section>;
}
