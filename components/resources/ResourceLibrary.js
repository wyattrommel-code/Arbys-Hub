"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowDown, ArrowUp, ArrowUpRight, BookOpen, Check, ClipboardList, Download, FileText, FolderOpen, GraduationCap, Link2, LockKeyhole, Pencil, Pin, Plus, RotateCcw, Search, Settings2, ShieldCheck, Upload, Utensils, Wrench, X } from "lucide-react";
import { filterResources, formatResourceSize, MAX_RESOURCE_CATEGORIES, normalizeResourceTags, RESOURCE_CATEGORIES, RESOURCE_CATEGORY_ICONS, RESOURCE_FILE_ACCEPT, RESOURCE_TAGS, resourceCategory, validateResourceCategories, validateResourceFile } from "@/lib/resources";
import styles from "./ResourceLibrary.module.css";
import StoreSwitcher from "@/components/equipment/StoreSwitcher";
import EquipmentRegister from "@/components/equipment/EquipmentRegister";

const CATEGORY_ICONS = { wrench: Wrench, graduation: GraduationCap, clipboard: ClipboardList, utensils: Utensils, shield: ShieldCheck, book: BookOpen, folder: FolderOpen };
const ICON_LABELS = { wrench: "Equipment", graduation: "Training", clipboard: "Operations", utensils: "Food", shield: "Safety", folder: "Folder", book: "Book" };
const EMPTY_FORM = { title: "", category: "equipment", summary: "", notes: "", url: "", visibility: "team", pinned: false, tags: [] };

async function apiRequest(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (response.redirected && new URL(response.url).pathname === "/login") throw new Error("Your session ended. Please sign in again.");
  let json;
  try { json = await response.json(); } catch { throw new Error("Could not complete the request. Please reload and try again."); }
  if (!response.ok) throw Object.assign(new Error(json.error || "Could not complete the request."), { setupRequired: json.setup_required });
  return json;
}

function Modal({ title, children, onClose, busy = false, wide = false }) {
  const dialogRef = useRef(null);
  const titleId = wide ? "resource-editor-title" : "resource-detail-title";
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = oldOverflow; };
  }, []);
  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${wide ? styles.wideDialog : ""}`} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className={styles.dialogHeader}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className={styles.iconButton} aria-label="Close resource" onClick={onClose} disabled={busy}><X size={20} /></button>
      </div>
      {children}
    </dialog>
  );
}

function TabManager({ categories, version, onClose, onSaved }) {
  const [tabs, setTabs] = useState(() => categories.map((tab) => ({ ...tab })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const originalKeys = new Set(categories.map((tab) => tab.value));
  function update(value, field, text) { setTabs((current) => current.map((tab) => tab.value === value ? { ...tab, [field]: text } : tab)); }
  function move(index, delta) {
    setTabs((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }
  async function save(event) {
    event.preventDefault(); setError("");
    try {
      const validated = validateResourceCategories(tabs);
      setBusy(true);
      const result = await apiRequest("/api/resources/categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories: validated, version }) });
      onSaved(result);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Manage tabs" onClose={onClose} busy={busy} wide>
    <form onSubmit={save} className={styles.tabManager}>
      <p className={styles.tabIntro}>Add or rename tabs and use the arrows to change their order. Changes apply to everyone at this store.</p>
      <fieldset disabled={busy} className={styles.tabFields}>
        <ol className={styles.tabList}>{tabs.map((tab, index) => <li key={tab.value} className={styles.tabRow}>
          <div className={styles.tabRowTop}><span className={styles.tabNumber}>{index + 1}</span>
            <label className={styles.field}><span className={styles.srOnly}>Tab {index + 1} name</span><input aria-label={`Tab ${index + 1} name`} value={tab.label} onChange={(event) => update(tab.value, "label", event.target.value)} required maxLength={60} placeholder="Tab name" /></label>
            <button className={styles.iconButton} type="button" aria-label={`Move ${tab.label || "new tab"} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
            <button className={styles.iconButton} type="button" aria-label={`Move ${tab.label || "new tab"} down`} disabled={index === tabs.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
            {!originalKeys.has(tab.value) ? <button className={styles.iconButton} type="button" aria-label={`Remove new tab ${tab.label}`} onClick={() => setTabs((current) => current.filter((item) => item.value !== tab.value))}><X size={17} /></button> : null}
          </div>
          <div className={styles.tabRowBottom}>
            <label className={styles.field}><span className={styles.srOnly}>Description for tab {index + 1}</span><input aria-label={`Description for tab ${index + 1}`} value={tab.description} onChange={(event) => update(tab.value, "description", event.target.value)} maxLength={160} placeholder="Short description (optional)" /></label>
            <label className={styles.field}><span className={styles.srOnly}>Icon for tab {index + 1}</span><select aria-label={`Icon for tab ${index + 1}`} value={tab.icon} onChange={(event) => update(tab.value, "icon", event.target.value)}>{RESOURCE_CATEGORY_ICONS.map((icon) => <option key={icon} value={icon}>{ICON_LABELS[icon]}</option>)}</select></label>
          </div>
        </li>)}</ol>
        <button type="button" className={styles.secondaryButton} disabled={tabs.length >= MAX_RESOURCE_CATEGORIES} onClick={() => setTabs((current) => [...current, { value: `custom_${crypto.randomUUID().replaceAll("-", "")}`, label: "", description: "", icon: "folder" }])}><Plus size={17} />Add tab</button>
      </fieldset>
      {error ? <div role="alert" className={styles.error}>{error}</div> : null}
      <div className={styles.dialogFooter}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={busy}>Cancel</button><button className={styles.primaryButton} disabled={busy}><Check size={17} />{busy ? "Saving…" : "Save tabs"}</button></div>
    </form>
  </Modal>;
}

function ResourceEditor({ resource, category, categories, onClose, onSaved }) {
  const [form, setForm] = useState(resource ? { ...resource, tags: resource.tags || [] } : { ...EMPTY_FORM, category: category === "all" ? categories[0]?.value : category });
  const [tagDraft, setTagDraft] = useState("");
  const [file, setFile] = useState(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  function change(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }
  function selectFile(event) {
    const selected = event.target.files?.[0];
    setError("");
    if (!selected) { setFile(null); return; }
    try { validateResourceFile(selected); setFile(selected); }
    catch (error) { setFile(null); event.target.value = ""; setError(error.message); }
  }
  function updateTags(tags) {
    try { setForm((current) => ({ ...current, tags: normalizeResourceTags(tags) })); setError(""); return true; }
    catch (error) { setError(error.message); return false; }
  }
  function addTags() {
    if (updateTags([...form.tags, ...tagDraft.split(",")])) setTagDraft("");
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("resource", JSON.stringify({ ...form, tags: normalizeResourceTags([...form.tags, ...tagDraft.split(",")]) }));
      if (file) data.append("file", file);
      data.append("remove_attachment", String(removeAttachment));
      const result = await apiRequest(resource ? `/api/resources/${resource.id}` : "/api/resources", { method: resource ? "PUT" : "POST", body: data });
      onSaved(result.resource);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={resource ? "Edit resource" : "Add resource"} onClose={onClose} busy={busy} wide>
      <form onSubmit={save} className={styles.editor}>
        <fieldset disabled={busy}>
          <label className={styles.field}>Title <span className={styles.required}>Required</span>
            <input autoFocus name="title" value={form.title} onChange={change} required maxLength={160} placeholder="e.g. Weekly slicer cleaning schedule" />
          </label>
          <div className={styles.formColumns}>
            <label className={styles.field}>Tab
              <select name="category" value={form.category} onChange={change}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </label>
            <label className={styles.field}>Who can view this?
              <select name="visibility" value={form.visibility} onChange={change}><option value="team">Everyone at this store</option><option value="managers">GM and assistant managers</option></select>
            </label>
          </div>
          <div className={styles.tagEditor} role="group" aria-label="Document tags">
            <p className={styles.fieldTitle}>Tags</p><p className={styles.hint}>Choose document types or add your own. A resource can have more than one tag.</p>
            <div className={styles.tagOptions}>{[...new Set([...RESOURCE_TAGS, ...form.tags])].map((tag) => <button type="button" key={tag} className={`${styles.tagOption} ${form.tags.includes(tag) ? styles.tagSelected : ""}`} aria-pressed={form.tags.includes(tag)} onClick={() => updateTags(form.tags.includes(tag) ? form.tags.filter((value) => value !== tag) : [...form.tags, tag])}>{form.tags.includes(tag) ? <Check size={12} /> : <Plus size={12} />}{tag}</button>)}</div>
            <div className={styles.customTags}><label className={styles.field}><span className={styles.srOnly}>Custom tags</span><input aria-label="Custom tags" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTags(); } }} placeholder="e.g. Cleaning, Maintenance" /></label><button type="button" className={styles.secondaryButton} onClick={addTags} disabled={!tagDraft.trim()}>Add tags</button></div>
          </div>
          <label className={styles.field}>Short description
            <textarea name="summary" value={form.summary} onChange={change} maxLength={500} rows={2} placeholder="A quick description to help the team find this." />
          </label>
          <label className={styles.field}>Website or document link
            <input name="url" type="url" value={form.url} onChange={change} maxLength={2000} placeholder="https://" />
          </label>
          <label className={styles.field}>Notes or instructions
            <textarea name="notes" value={form.notes} onChange={change} maxLength={30000} rows={6} placeholder="Add the procedure, schedule, or instructions here." />
          </label>
          <div className={styles.field}>
            <label htmlFor="resource-file">Attachment</label>
            <div className={styles.uploadBox}>
              <Upload size={22} aria-hidden="true" />
              <div><input ref={fileRef} id="resource-file" type="file" accept={RESOURCE_FILE_ACCEPT} onChange={selectFile} aria-describedby="resource-file-help" />
                <p id="resource-file-help" className={styles.hint}>PDF, Office, text, CSV, or images. Up to 4 MB. Link to larger files.</p></div>
            </div>
            {file ? <div className={styles.attachmentLine}><span>{file.name} · {formatResourceSize(file.size)}</span><button type="button" className={styles.textButton} onClick={() => { setFile(null); fileRef.current.value = ""; }}>Clear selection</button></div> : null}
            {resource?.file_name ? <label className={styles.checkLabel}><input type="checkbox" checked={removeAttachment} onChange={(event) => setRemoveAttachment(event.target.checked)} /> Remove current file: {resource.file_name}{file ? " (the new file will replace it)" : ""}</label> : null}
          </div>
          <label className={styles.checkLabel}><input name="pinned" type="checkbox" checked={form.pinned} onChange={change} /> Pin this resource for quick access</label>
          <p className={styles.hint}>For Learner Hub, add sign-in instructions and links. Keep individual passwords and PINs out of shared resources.</p>
        </fieldset>
        {error ? <div role="alert" className={styles.error}>{error}</div> : null}
        <div className={styles.dialogFooter}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={busy}>Cancel</button><button className={styles.primaryButton} disabled={busy}><Check size={17} />{busy ? "Saving…" : resource ? "Save changes" : "Add resource"}</button></div>
      </form>
    </Modal>
  );
}

function ResourceDetail({ resource, categories, canManage, onClose, onEdit, onArchived }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const category = resourceCategory(resource.category, categories);
  async function archive() {
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/resources/${resource.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: !resource.archived, version: resource.version }) });
      onArchived(resource.archived ? "Resource restored." : "Resource archived. You can restore it from Archived.");
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={resource.title} onClose={onClose} busy={busy}>
      <div className={styles.detailBody}>
        <div className={styles.badges}><span className={styles.categoryBadge}>{category.label}</span>{resource.visibility === "managers" ? <span className={styles.badge}><LockKeyhole size={13} />Managers only</span> : null}{resource.pinned ? <span className={styles.badge}><Pin size={13} />Pinned</span> : null}{resource.archived ? <span className={styles.badge}>Archived</span> : null}</div>
        {resource.tags?.length ? <div className={styles.badges} aria-label="Document tags">{resource.tags.map((tag) => <span className={styles.documentTag} key={tag}>{tag}</span>)}</div> : null}
        {resource.summary ? <p className={styles.detailSummary}>{resource.summary}</p> : null}
        {resource.notes ? <div className={styles.notes}>{resource.notes}</div> : null}
        {resource.url ? <a className={styles.linkBox} href={resource.url} target="_blank" rel="noopener noreferrer"><Link2 size={19} /><span><strong>Open link</strong><small>{resource.url}</small></span><ArrowUpRight size={18} /></a> : null}
        {resource.file_name && !resource.archived ? <a className={styles.linkBox} href={`/api/resources/${resource.id}/file`} target="_blank" rel="noopener noreferrer"><FileText size={20} /><span><strong>{resource.file_name}</strong><small>{formatResourceSize(resource.file_size)}</small></span><Download size={18} /></a> : null}
        {resource.archived && resource.file_name ? <p className={styles.hint}>Attachment: {resource.file_name}. Restore this resource to download it.</p> : null}
        <p className={styles.updated}>Updated {new Date(resource.updated_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver" })}</p>
        {error ? <div role="alert" className={styles.error}>{error}</div> : null}
        {confirmArchive ? <div className={styles.archivePrompt}><p>Archive this resource? It will be hidden from the team and can be restored later.</p><div><button className={styles.secondaryButton} onClick={() => setConfirmArchive(false)} disabled={busy}>Keep resource</button><button className={styles.dangerButton} onClick={archive} disabled={busy}>{busy ? "Archiving…" : "Archive resource"}</button></div></div> : null}
      </div>
      <div className={styles.dialogFooter}>
        {canManage ? <button className={styles.textButton} onClick={resource.archived ? archive : () => setConfirmArchive(true)} disabled={busy}>{resource.archived ? <RotateCcw size={16} /> : <Archive size={16} />}{resource.archived ? busy ? "Restoring…" : "Restore resource" : "Archive"}</button> : null}
        <div className={styles.footerRight}><button className={styles.secondaryButton} onClick={onClose} disabled={busy}>Close</button>{canManage && !resource.archived ? <button className={styles.primaryButton} onClick={onEdit} disabled={busy}><Pencil size={16} />Edit resource</button> : null}</div>
      </div>
    </Modal>
  );
}

export default function ResourceLibrary() {
  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState(RESOURCE_CATEGORIES);
  const [categoriesVersion, setCategoriesVersion] = useState(1);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [tag, setTag] = useState("all");
  const [archived, setArchived] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(""); setSetupRequired(false);
      try {
        const data = await apiRequest(`/api/resources${archived ? "?archived=true" : ""}`);
        if (!cancelled) { setResources(data.resources); setCategories(data.categories); setCategoriesVersion(data.categories_version); setCanManage(data.can_manage); }
      } catch (error) {
        if (!cancelled) { setResources([]); setError(error.message); setSetupRequired(Boolean(error.setupRequired)); }
      } finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [archived, reloadKey]);
  const visible = useMemo(() => filterResources(resources, { category, search, pinnedOnly, sort, tag, categories }), [resources, category, search, pinnedOnly, sort, tag, categories]);
  const tagOptions = useMemo(() => [...new Set([...resources.flatMap((resource) => resource.tags || []), ...(tag === "all" ? [] : [tag])])].sort((a, b) => a.localeCompare(b)), [resources, tag]);
  const activeCategory = category === "all" ? null : resourceCategory(category, categories);
  function reload(message) { setModal(null); setNotice(message); setReloadKey((key) => key + 1); }
  function resetFilters() { setSearch(""); setCategory("all"); setPinnedOnly(false); setTag("all"); }
  return (
    <div className={styles.library}>
      <StoreSwitcher />
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>STORE RESOURCE LIBRARY</p><h1>Database</h1><p className={styles.subtitle}>The information your team needs, all in one place.</p></div>
        {canManage ? <div className={styles.headingActions}><button className={styles.secondaryButton} onClick={() => setModal({ mode: "tabs" })} disabled={loading || Boolean(error)}><Settings2 size={17} />Manage tabs</button><button className={styles.primaryButton} onClick={() => setModal({ mode: "edit", resource: null })} disabled={loading || Boolean(error)}><Plus size={18} />Add resource</button></div> : null}
      </header>
      <div className={styles.categories} aria-label="Resource tabs">
        {categories.map((item) => {
          const Icon = CATEGORY_ICONS[item.icon] || FolderOpen;
          return <button key={item.value} className={`${styles.categoryCard} ${category === item.value ? styles.categoryActive : ""}`} aria-pressed={category === item.value} onClick={() => setCategory(category === item.value ? "all" : item.value)}><span className={styles.categoryTop}><Icon size={22} /></span><strong>{item.label}</strong><small>{item.description}</small></button>;
        })}
      </div>
      {category === "equipment" ? <EquipmentRegister embedded /> : null}
      <section className={styles.collection} aria-label="Resource library">
        <div className={styles.collectionHeader}><div><button className={`${styles.collectionTab} ${category === "all" ? styles.collectionTabActive : ""}`} onClick={() => setCategory("all")} aria-pressed={category === "all"}>All resources</button>{activeCategory ? <span className={styles.currentCategory}>/ {activeCategory.label}</span> : null}</div><span className={styles.count}>{loading ? "Loading…" : error ? "Unavailable" : `${visible.length} ${visible.length === 1 ? "resource" : "resources"}`}</span></div>
        <div className={styles.toolbar}>
          <label className={styles.search}><Search size={18} aria-hidden="true" /><span className={styles.srOnly}>Search resources</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, notes, or files…" /></label>
          <label className={styles.checkLabel}><input type="checkbox" checked={pinnedOnly} onChange={(event) => setPinnedOnly(event.target.checked)} /><Pin size={14} />Pinned</label>
          <label className={styles.selectLabel}><span className={styles.srOnly}>Filter by tag</span><select aria-label="Filter by tag" value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">All tags</option>{tagOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className={styles.selectLabel}><span className={styles.srOnly}>Sort resources</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recently updated</option><option value="title">Title A–Z</option></select></label>
          {canManage ? <label className={styles.selectLabel}><span className={styles.srOnly}>Resource status</span><select value={archived ? "archived" : "active"} onChange={(event) => { setArchived(event.target.value === "archived"); setNotice(""); }}><option value="active">Active</option><option value="archived">Archived</option></select></label> : null}
        </div>
        {notice ? <div className={styles.notice} role="status"><Check size={17} /><span>{notice}</span><button aria-label="Dismiss notification" className={styles.iconButton} onClick={() => setNotice("")}><X size={16} /></button></div> : null}
        {loading ? <div className={styles.empty} role="status"><BookOpen size={30} /><h2>Loading your resources…</h2></div>
          : error ? <div className={styles.empty} role="alert"><FolderOpen size={32} /><h2>{setupRequired ? "Your library is waiting for setup" : "Could not load resources"}</h2><p>{error}</p><button className={styles.secondaryButton} onClick={() => setReloadKey((key) => key + 1)}>Try again</button></div>
          : visible.length ? <div className={styles.resourceGrid}>{visible.map((resource) => {
            const itemCategory = resourceCategory(resource.category, categories);
            const Icon = CATEGORY_ICONS[itemCategory.icon] || FolderOpen;
            return <button key={resource.id} className={styles.resourceCard} onClick={() => setModal({ mode: "view", resource })}>
              <div className={styles.resourceTop}><span className={styles.resourceIcon}><Icon size={21} /></span><div className={styles.badges}>{resource.visibility === "managers" ? <span title="GM and assistant managers only"><LockKeyhole size={15} aria-label="Managers only" /></span> : null}{resource.pinned ? <Pin size={15} aria-label="Pinned" /> : null}</div></div>
              <span className={styles.cardCategory}>{itemCategory.label}</span><h2>{resource.title}</h2><p className={styles.cardSummary}>{resource.summary || (resource.notes ? resource.notes.slice(0, 160) : resource.file_name || "Open this resource for details.")}</p>
              {resource.tags?.length ? <div className={styles.cardTags}>{resource.tags.map((tag) => <span className={styles.documentTag} key={tag}>{tag}</span>)}</div> : null}
              <div className={styles.cardMeta}><span>{resource.file_name ? <><FileText size={14} />File</> : null}{resource.url ? <><Link2 size={14} />Link</> : null}{!resource.file_name && !resource.url ? <><FileText size={14} />Notes</> : null}</span><time dateTime={resource.updated_at}>{new Date(resource.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" })}</time></div>
            </button>;
          })}</div>
          : <div className={styles.empty}><FolderOpen size={36} /><h2>{search || pinnedOnly || tag !== "all" ? "No matching resources" : archived ? "No archived resources" : activeCategory ? `No ${activeCategory.label.toLowerCase()} yet` : "Build your store's library"}</h2><p>{search || pinnedOnly || tag !== "all" ? "Try another search or clear your filters." : archived ? "Resources you archive will appear here. You can restore them at any time." : canManage ? "Add a file, a useful link, or a set of instructions for your team." : "Resources will appear here when a manager adds them."}</p>{search || pinnedOnly || tag !== "all" ? <button className={styles.secondaryButton} onClick={resetFilters}>Clear filters</button> : canManage && !archived ? <button className={styles.primaryButton} onClick={() => setModal({ mode: "edit", resource: null })}><Plus size={17} />Add your first resource</button> : null}</div>}
      </section>
      <p className={styles.libraryFootnote}><BookOpen size={15} />Browse by topic. Use tags to find SOPs, schedules, manuals, videos, and forms.</p>
      {modal?.mode === "tabs" ? <TabManager categories={categories} version={categoriesVersion} onClose={() => setModal(null)} onSaved={() => reload("Tabs updated.")} /> : null}
      {modal?.mode === "edit" ? <ResourceEditor key={modal.resource?.id || "new"} resource={modal.resource} category={category} categories={categories} onClose={() => setModal(null)} onSaved={() => reload(modal.resource ? "Resource updated." : "Resource added.")} /> : null}
      {modal?.mode === "view" ? <ResourceDetail resource={modal.resource} categories={categories} canManage={canManage} onClose={() => setModal(null)} onEdit={() => setModal({ ...modal, mode: "edit" })} onArchived={reload} /> : null}
    </div>
  );
}
