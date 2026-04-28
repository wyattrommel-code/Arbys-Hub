"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const RED = "#C8102E";
const STATIONS = ["DT Order Taker", "DT Cashier", "Runner", "Front", "Fryer", "Slicer", "Backline", "Floater"];
const QUESTION_CATEGORIES = ["safety", "quality", "speed", "knowledge"];
const RAISE_REASONS = ["Performance Review", "Annual Raise", "Promotion", "Correction", "Other"];
const TABS = ["ROSTER", "CERTIFICATIONS", "TRAINING", "QUESTION BANK"];
const ROLE_OPTIONS = ["Morning", "Breakfast", "Open", "Day Lead", "Mid Shift", "Night", "Night Lead", "Closing"];

function toDateStr(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function roleColor(roleText) {
  const role = String(roleText || "").toLowerCase();
  if (role.includes("breakfast") || role.includes("open")) return "#E8A020";
  if (role.includes("morning") || role.includes("day lead")) return "#3B82F6";
  if (role.includes("mid")) return "#8B5CF6";
  if (role.includes("night lead") || role === "night" || role.includes("night ")) return RED;
  if (role.includes("closing") || role.includes("close")) return "#1a1a1a";
  return "#6b7280";
}

function fullName(emp) {
  return `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
}

function byLastName(a, b) {
  const aLast = String(a.last_name || "").toLowerCase();
  const bLast = String(b.last_name || "").toLowerCase();
  if (aLast === bLast) return String(a.first_name || "").localeCompare(String(b.first_name || ""));
  return aLast.localeCompare(bLast);
}

function money(rate) {
  const n = Number(rate || 0);
  return `$${n.toFixed(2)}/hr`;
}

function daysBetween(startDate, endDate = new Date()) {
  if (!startDate) return 0;
  const s = new Date(startDate);
  if (Number.isNaN(s.getTime())) return 0;
  const ms = new Date(endDate).getTime() - s.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function normalizeStatus(value) {
  const v = String(value || "").toLowerCase();
  if (v === "terminated") return "terminated";
  if (v === "inactive") return "inactive";
  return "active";
}

function statusBadgeClass(status) {
  if (status === "terminated") return "bg-red-100 text-red-700";
  if (status === "inactive") return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-700";
}

function stationStatusBadge(cert) {
  const status = cert?.status || "";
  if (status === "certified") return "bg-green-100 text-green-700";
  if (status === "in_training") return "bg-yellow-100 text-yellow-800";
  return "bg-zinc-100 text-zinc-600";
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div className="h-full w-full overflow-y-auto bg-white p-4 dark:bg-zinc-950 sm:mx-auto sm:mt-12 sm:h-auto sm:max-h-[88vh] sm:w-[760px] sm:rounded-xl sm:border sm:border-zinc-200 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-2 py-1 text-sm">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function PeoplePage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [tab, setTab] = useState("ROSTER");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState([]);
  const [wages, setWages] = useState([]);
  const [certs, setCerts] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [attempts, setAttempts] = useState([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [addForm, setAddForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    hire_date: toDateStr(new Date()),
    primary_role: ROLE_OPTIONS[0],
    is_shift_lead: false,
    status: "active",
    starting_wage: "",
  });

  const [wageHistoryEmployee, setWageHistoryEmployee] = useState(null);
  const [raiseEmployee, setRaiseEmployee] = useState(null);
  const [raiseForm, setRaiseForm] = useState({
    new_rate: "",
    effective_date: toDateStr(new Date()),
    reason: "Performance Review",
    notes: "",
  });

  const [certModal, setCertModal] = useState(null);
  const [startTrainingTrainerId, setStartTrainingTrainerId] = useState("");
  const [attemptHistoryTarget, setAttemptHistoryTarget] = useState(null);

  const [testFlow, setTestFlow] = useState(null);
  const [logSessionTarget, setLogSessionTarget] = useState(null);
  const [logSessionShift, setLogSessionShift] = useState("Morning");
  const [questionStation, setQuestionStation] = useState(STATIONS[0]);
  const [newQuestion, setNewQuestion] = useState({ station: STATIONS[0], question_text: "", category: "knowledge" });
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [questionDraft, setQuestionDraft] = useState({ question_text: "", category: "knowledge" });

  async function reloadAll() {
    setLoading(true);
    setError("");
    try {
      const [empRes, wageRes, certRes, sessionRes, questionRes, attemptRes] = await Promise.all([
        supabase.from("employees").select("*"),
        supabase.from("employee_wages").select("*"),
        supabase.from("station_certifications").select("*"),
        supabase.from("training_sessions").select("*"),
        supabase.from("station_questions").select("*"),
        supabase.from("certification_attempts").select("*"),
      ]);
      const firstError = [empRes.error, wageRes.error, certRes.error, sessionRes.error, questionRes.error, attemptRes.error].find(Boolean);
      if (firstError) throw firstError;
      setEmployees(empRes.data || []);
      setWages(wageRes.data || []);
      setCerts(certRes.data || []);
      setSessions(sessionRes.data || []);
      setQuestions(questionRes.data || []);
      setAttempts(attemptRes.data || []);
    } catch (err) {
      setError(err?.message || "Failed to load people data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const employeesById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const currentWageByEmployee = useMemo(() => {
    const out = new Map();
    const sorted = [...wages].sort((a, b) => new Date(b.effective_date || b.created_at || 0) - new Date(a.effective_date || a.created_at || 0));
    for (const row of sorted) {
      if (!out.has(row.employee_id)) out.set(row.employee_id, row);
    }
    return out;
  }, [wages]);

  const certsByEmployeeStation = useMemo(() => {
    const out = new Map();
    for (const c of certs) out.set(`${c.employee_id}::${c.station}`, c);
    return out;
  }, [certs]);

  const rosterEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...employees]
      .filter((e) => {
        const status = normalizeStatus(e.status);
        if (statusFilter !== "all" && status !== statusFilter) return false;
        if (!q) return true;
        return fullName(e).toLowerCase().includes(q) || String(e.primary_role || "").toLowerCase().includes(q);
      })
      .sort(byLastName);
  }, [employees, search, statusFilter]);

  const activeEmployees = useMemo(() => employees.filter((e) => normalizeStatus(e.status) === "active").sort(byLastName), [employees]);

  const activeTrainers = activeEmployees;

  async function saveEmployeeEdit(employeeId) {
    const payload = {
      first_name: editForm.first_name,
      last_name: editForm.last_name,
      phone: editForm.phone || null,
      email: editForm.email || null,
      hire_date: editForm.hire_date || null,
      status: editForm.status,
      primary_role: editForm.primary_role || null,
      is_shift_lead: Boolean(editForm.is_shift_lead),
      notes: editForm.notes || null,
    };
    const { error: upErr } = await supabase.from("employees").update(payload).eq("id", employeeId);
    if (upErr) {
      setError(upErr.message || "Failed to update employee.");
      return;
    }
    setEditingId(null);
    reloadAll();
  }

  async function addEmployee() {
    if (!addForm.first_name.trim() || !addForm.last_name.trim()) {
      setError("First and last name are required.");
      return;
    }
    if (!addForm.starting_wage || Number(addForm.starting_wage) <= 0) {
      setError("Starting wage is required.");
      return;
    }
    setError("");
    const { data: inserted, error: empErr } = await supabase
      .from("employees")
      .insert({
        first_name: addForm.first_name.trim(),
        last_name: addForm.last_name.trim(),
        phone: addForm.phone || null,
        email: addForm.email || null,
        hire_date: addForm.hire_date || null,
        primary_role: addForm.primary_role || null,
        is_shift_lead: Boolean(addForm.is_shift_lead),
        status: addForm.status || "active",
      })
      .select("id")
      .single();
    if (empErr) {
      setError(empErr.message || "Failed to add employee.");
      return;
    }
    const { error: wageErr } = await supabase.from("employee_wages").insert({
      employee_id: inserted.id,
      hourly_rate: Number(addForm.starting_wage),
      effective_date: addForm.hire_date || toDateStr(new Date()),
      reason: "Starting Wage",
      approved_by: "Wyatt Rommel",
    });
    if (wageErr) {
      setError(wageErr.message || "Employee added but starting wage failed.");
    }
    setShowAddEmployee(false);
    setAddForm({
      first_name: "",
      last_name: "",
      phone: "",
      email: "",
      hire_date: toDateStr(new Date()),
      primary_role: ROLE_OPTIONS[0],
      is_shift_lead: false,
      status: "active",
      starting_wage: "",
    });
    reloadAll();
  }

  async function giveRaise() {
    if (!raiseEmployee || Number(raiseForm.new_rate) <= 0) {
      setError("Enter a valid new hourly rate.");
      return;
    }
    const { error: insErr } = await supabase.from("employee_wages").insert({
      employee_id: raiseEmployee.id,
      hourly_rate: Number(raiseForm.new_rate),
      effective_date: raiseForm.effective_date || toDateStr(new Date()),
      reason: raiseForm.reason,
      notes: raiseForm.notes || null,
      approved_by: "Wyatt Rommel",
    });
    if (insErr) {
      setError(insErr.message || "Failed to save raise.");
      return;
    }
    setRaiseEmployee(null);
    setRaiseForm({
      new_rate: "",
      effective_date: toDateStr(new Date()),
      reason: "Performance Review",
      notes: "",
    });
    reloadAll();
  }

  async function startTraining(certTarget) {
    if (!startTrainingTrainerId) {
      setError("Select a trainer.");
      return;
    }
    const trainer = employeesById.get(startTrainingTrainerId);
    const payload = {
      employee_id: certTarget.employee.id,
      station: certTarget.station,
      status: "in_training",
      trainer_id: startTrainingTrainerId,
      trainer_name: fullName(trainer),
      training_start_date: toDateStr(new Date()),
    };
    const { error: upErr } = await supabase.from("station_certifications").upsert(payload, { onConflict: "employee_id,station" });
    if (upErr) {
      setError(upErr.message || "Failed to start training.");
      return;
    }
    setCertModal(null);
    setStartTrainingTrainerId("");
    reloadAll();
  }

  function beginCertificationTest(certTarget, failedOnly = false) {
    const stationQuestions = questions.filter((q) => q.station === certTarget.station && q.is_active !== false);
    const baseQuestions = failedOnly && testFlow?.failedQuestionIds?.length
      ? stationQuestions.filter((q) => testFlow.failedQuestionIds.includes(q.id))
      : [...stationQuestions];
    const shuffled = [...baseQuestions].sort(() => Math.random() - 0.5);
    if (!shuffled.length) {
      setError("No active questions for this station.");
      return;
    }
    setCertModal(null);
    setTestFlow({
      employee: certTarget.employee,
      station: certTarget.station,
      cert: certTarget.cert,
      questions: shuffled,
      idx: 0,
      answers: [],
      noteDraft: "",
      failedQuestionIds: [],
      stage: "questions",
      trainerSignature: certTarget.cert?.trainer_name || "",
      gmApproved: false,
    });
  }

  function answerTestQuestion(passed) {
    setTestFlow((prev) => {
      if (!prev) return prev;
      const q = prev.questions[prev.idx];
      const nextAnswers = [...prev.answers, { question_id: q.id, passed, notes: prev.noteDraft || null, question_text: q.question_text }];
      const nextIdx = prev.idx + 1;
      if (nextIdx >= prev.questions.length) {
        const failed = nextAnswers.filter((a) => !a.passed).map((a) => a.question_id);
        return { ...prev, answers: nextAnswers, noteDraft: "", failedQuestionIds: failed, stage: "results" };
      }
      return { ...prev, answers: nextAnswers, idx: nextIdx, noteDraft: "" };
    });
  }

  async function submitCertificationAttempt(passOverride = false) {
    if (!testFlow) return;
    const passed = passOverride || testFlow.answers.every((a) => a.passed);
    const score = testFlow.answers.filter((a) => a.passed).length;
    const total = testFlow.answers.length;

    const { error: attemptErr } = await supabase.from("certification_attempts").insert({
      employee_id: testFlow.employee.id,
      station: testFlow.station,
      attempted_at: new Date().toISOString(),
      score,
      total_questions: total,
      passed,
      trainer_signature: testFlow.trainerSignature || null,
      gm_approved: Boolean(testFlow.gmApproved),
      failed_question_ids: testFlow.answers.filter((a) => !a.passed).map((a) => a.question_id),
      responses: testFlow.answers,
      trainer_id: testFlow.cert?.trainer_id || null,
    });
    if (attemptErr) {
      setError(attemptErr.message || "Failed to record attempt.");
      return;
    }

    if (passed) {
      const { error: certErr } = await supabase.from("station_certifications").upsert(
        {
          employee_id: testFlow.employee.id,
          station: testFlow.station,
          status: "certified",
          certified_date: toDateStr(new Date()),
          certified_by: "Wyatt Rommel",
          trainer_id: testFlow.cert?.trainer_id || null,
          trainer_name: testFlow.cert?.trainer_name || null,
        },
        { onConflict: "employee_id,station" }
      );
      if (certErr) {
        setError(certErr.message || "Attempt recorded, but certification update failed.");
      }
      setTestFlow(null);
      reloadAll();
      return;
    }

    const { error: bumpErr } = await supabase
      .from("station_certifications")
      .upsert(
        {
          employee_id: testFlow.employee.id,
          station: testFlow.station,
          status: "in_training",
          attempt_count: Number(testFlow.cert?.attempt_count || 0) + 1,
          trainer_id: testFlow.cert?.trainer_id || null,
          trainer_name: testFlow.cert?.trainer_name || null,
          training_start_date: testFlow.cert?.training_start_date || toDateStr(new Date()),
        },
        { onConflict: "employee_id,station" }
      );
    if (bumpErr) setError(bumpErr.message || "Failed to increment attempt count.");
    reloadAll();
  }

  async function markTrainingCompleteWithoutTest(certTarget) {
    const ok = window.confirm("Mark training complete and certify without test?");
    if (!ok) return;
    const { error: upErr } = await supabase.from("station_certifications").upsert(
      {
        employee_id: certTarget.employee.id,
        station: certTarget.station,
        status: "certified",
        certified_date: toDateStr(new Date()),
        certified_by: "Wyatt Rommel",
        trainer_id: certTarget.cert?.trainer_id || null,
        trainer_name: certTarget.cert?.trainer_name || null,
      },
      { onConflict: "employee_id,station" }
    );
    if (upErr) {
      setError(upErr.message || "Failed to complete training.");
      return;
    }
    setCertModal(null);
    reloadAll();
  }

  async function logTrainingSession() {
    if (!logSessionTarget) return;
    const { employee, cert } = logSessionTarget;
    const { error: insErr } = await supabase.from("training_sessions").insert({
      employee_id: employee.id,
      trainer_id: cert?.trainer_id || null,
      station: cert?.station || logSessionTarget.station,
      session_date: toDateStr(new Date()),
      shift: logSessionShift,
    });
    if (insErr) {
      setError(insErr.message || "Failed to log training session.");
      return;
    }
    setLogSessionTarget(null);
    reloadAll();
  }

  async function toggleQuestionActive(row) {
    const { error: upErr } = await supabase.from("station_questions").update({ is_active: !row.is_active }).eq("id", row.id);
    if (upErr) {
      setError(upErr.message || "Failed to update question.");
      return;
    }
    reloadAll();
  }

  async function saveQuestionEdit() {
    if (!editingQuestionId) return;
    const { error: upErr } = await supabase
      .from("station_questions")
      .update({ question_text: questionDraft.question_text, category: questionDraft.category })
      .eq("id", editingQuestionId);
    if (upErr) {
      setError(upErr.message || "Failed to save question.");
      return;
    }
    setEditingQuestionId(null);
    reloadAll();
  }

  async function softDeleteQuestion(row) {
    const { error: upErr } = await supabase.from("station_questions").update({ is_active: false }).eq("id", row.id);
    if (upErr) {
      setError(upErr.message || "Failed to deactivate question.");
      return;
    }
    reloadAll();
  }

  async function addQuestion() {
    if (!newQuestion.question_text.trim()) {
      setError("Question text is required.");
      return;
    }
    const { error: insErr } = await supabase.from("station_questions").insert({
      station: newQuestion.station,
      question_text: newQuestion.question_text.trim(),
      category: newQuestion.category,
      is_active: true,
    });
    if (insErr) {
      setError(insErr.message || "Failed to add question.");
      return;
    }
    setNewQuestion({ station: questionStation, question_text: "", category: "knowledge" });
    reloadAll();
  }

  const trainingRows = useMemo(() => {
    return certs
      .filter((c) => c.status === "in_training")
      .map((cert) => {
        const employee = employeesById.get(cert.employee_id);
        const sessionCount = sessions.filter((s) => s.employee_id === cert.employee_id && s.station === cert.station).length;
        return {
          cert,
          employee,
          sessionCount,
          days: daysBetween(cert.training_start_date),
        };
      })
      .filter((r) => r.employee)
      .sort((a, b) => byLastName(a.employee, b.employee));
  }, [certs, employeesById, sessions]);

  const trainerCards = useMemo(() => {
    const trainerIds = [...new Set(sessions.map((s) => s.trainer_id).filter(Boolean))];
    return trainerIds
      .map((trainerId) => {
        const trainer = employeesById.get(trainerId);
        if (!trainer) return null;
        const trainerSessions = sessions.filter((s) => s.trainer_id === trainerId);
        const certifiedByTrainer = certs.filter((c) => c.status === "certified" && c.trainer_id === trainerId);
        const currentTrainees = certs.filter((c) => c.status === "in_training" && c.trainer_id === trainerId);
        const avgDays =
          certifiedByTrainer.length > 0
            ? certifiedByTrainer.reduce((sum, c) => sum + daysBetween(c.training_start_date, c.certified_date || new Date()), 0) / certifiedByTrainer.length
            : 0;

        const firstAttemptRows = [];
        for (const c of certifiedByTrainer) {
          const keyRows = attempts
            .filter((a) => a.employee_id === c.employee_id && a.station === c.station && a.trainer_id === trainerId)
            .sort((a, b) => new Date(a.attempted_at || 0) - new Date(b.attempted_at || 0));
          if (keyRows[0]) firstAttemptRows.push(keyRows[0]);
        }
        const firstPassRate =
          firstAttemptRows.length > 0
            ? (firstAttemptRows.filter((r) => r.passed).length / firstAttemptRows.length) * 100
            : 0;

        const stationBreakdown = STATIONS.map((station) => {
          const trainees = certs.filter((c) => c.station === station && c.trainer_id === trainerId && c.status === "in_training");
          const completed = certs.filter((c) => c.station === station && c.trainer_id === trainerId && c.status === "certified");
          const avgStationDays = completed.length
            ? completed.reduce((sum, c) => sum + daysBetween(c.training_start_date, c.certified_date || new Date()), 0) / completed.length
            : 0;
          const stationAttempts = attempts.filter((a) => a.station === station && a.trainer_id === trainerId);
          const passRate = stationAttempts.length
            ? (stationAttempts.filter((a) => a.passed).length / stationAttempts.length) * 100
            : 0;
          return { station, trainees: trainees.length, avgDays: avgStationDays, passRate };
        });

        return {
          trainer,
          totalEmployeesTrained: new Set(certifiedByTrainer.map((c) => c.employee_id)).size,
          avgDays,
          firstPassRate,
          currentTrainees: currentTrainees.length,
          stationBreakdown,
          trainerSessions: trainerSessions.length,
        };
      })
      .filter(Boolean)
      .sort((a, b) => byLastName(a.trainer, b.trainer));
  }, [sessions, certs, attempts, employeesById]);

  const stationQuestions = useMemo(
    () => questions.filter((q) => q.station === questionStation).sort((a, b) => Number(b.is_active) - Number(a.is_active)),
    [questions, questionStation]
  );

  const stationQuestionCount = useMemo(
    () =>
      STATIONS.map((station) => {
        const all = questions.filter((q) => q.station === station);
        const active = all.filter((q) => q.is_active !== false);
        return { station, total: all.length, active: active.length };
      }),
    [questions]
  );

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5">
      <header>
        <h2 className="text-2xl font-bold text-[#C8102E]">People</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">GM-only people management. 🔒</p>
      </header>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-4">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`rounded-lg py-2 text-xs font-bold sm:text-sm ${
              tab === name ? "bg-[#C8102E] text-white" : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading people data...</p> : null}

      {!loading && tab === "ROSTER" ? (
        <article className="space-y-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees..."
                className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950 sm:max-w-sm"
              />
              <button type="button" onClick={() => setShowAddEmployee(true)} className="h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
                Add New Employee
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { key: "all", label: "All" },
                { key: "active", label: "Active" },
                { key: "inactive", label: "Inactive" },
                { key: "terminated", label: "Terminated" },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    statusFilter === f.key ? "border-[#C8102E] bg-[#C8102E] text-white" : "border-zinc-300 text-zinc-700"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {rosterEmployees.map((emp) => {
            const expanded = expandedId === emp.id;
            const isEditing = editingId === emp.id;
            const status = normalizeStatus(emp.status);
            const currentWage = currentWageByEmployee.get(emp.id);
            const employeeCerts = certs.filter((c) => c.employee_id === emp.id);
            return (
              <article key={emp.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <button type="button" className="w-full text-left" onClick={() => setExpandedId((prev) => (prev === emp.id ? null : emp.id))}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-zinc-900 dark:text-zinc-100">
                        {fullName(emp)} {emp.is_shift_lead ? "⭐" : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded px-2 py-0.5 text-xs text-white" style={{ background: roleColor(emp.primary_role) }}>
                          {emp.primary_role || "Unassigned role"}
                        </span>
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(status)}`}>{status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {employeeCerts.length ? (
                      employeeCerts.map((c) => (
                        <span key={`${c.employee_id}-${c.station}`} className={`rounded px-2 py-0.5 text-[11px] ${stationStatusBadge(c)}`}>
                          {c.station}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-zinc-400">No station progress yet</span>
                    )}
                  </div>
                </button>

                {expanded ? (
                  <div className="mt-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
                    {!isEditing ? (
                      <>
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                          <p>
                            <span className="font-semibold">Phone:</span> {emp.phone || "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Email:</span> {emp.email || "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Hire Date:</span> {emp.hire_date || "—"}
                          </p>
                          <p>
                            <span className="font-semibold">Current Wage 🔒:</span> {money(currentWage?.hourly_rate)}
                          </p>
                          <p>
                            <span className="font-semibold">Regular:</span> {money(currentWage?.hourly_rate)}
                          </p>
                          <p>
                            <span className="font-semibold">Overtime:</span> {money((Number(currentWage?.hourly_rate) || 0) * 1.5)} (1.5x)
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setWageHistoryEmployee(emp)} className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold">
                            Wage History
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(emp.id);
                              setEditForm({
                                first_name: emp.first_name || "",
                                last_name: emp.last_name || "",
                                phone: emp.phone || "",
                                email: emp.email || "",
                                hire_date: emp.hire_date || "",
                                status: normalizeStatus(emp.status),
                                primary_role: emp.primary_role || ROLE_OPTIONS[0],
                                is_shift_lead: Boolean(emp.is_shift_lead),
                                notes: emp.notes || "",
                              });
                            }}
                            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRaiseEmployee(emp);
                              setRaiseForm({ new_rate: "", effective_date: toDateStr(new Date()), reason: "Performance Review", notes: "" });
                            }}
                            className="rounded-lg bg-[#C8102E] px-3 py-2 text-xs font-semibold text-white"
                          >
                            Give Raise
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {[
                          ["first_name", "First Name"],
                          ["last_name", "Last Name"],
                          ["phone", "Phone"],
                          ["email", "Email"],
                        ].map(([key, label]) => (
                          <label key={key} className="text-xs font-medium text-zinc-600">
                            {label}
                            <input
                              type="text"
                              value={editForm[key]}
                              onChange={(e) => setEditForm((s) => ({ ...s, [key]: e.target.value }))}
                              className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            />
                          </label>
                        ))}
                        <label className="text-xs font-medium text-zinc-600">
                          Hire Date
                          <input
                            type="date"
                            value={editForm.hire_date}
                            onChange={(e) => setEditForm((s) => ({ ...s, hire_date: e.target.value }))}
                            className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          />
                        </label>
                        <label className="text-xs font-medium text-zinc-600">
                          Status
                          <select
                            value={editForm.status}
                            onChange={(e) => setEditForm((s) => ({ ...s, status: e.target.value }))}
                            className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="terminated">Terminated</option>
                          </select>
                        </label>
                        <label className="text-xs font-medium text-zinc-600 sm:col-span-2">
                          Primary Role
                          <select
                            value={editForm.primary_role}
                            onChange={(e) => setEditForm((s) => ({ ...s, primary_role: e.target.value }))}
                            className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          >
                            {ROLE_OPTIONS.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-600 sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={Boolean(editForm.is_shift_lead)}
                            onChange={(e) => setEditForm((s) => ({ ...s, is_shift_lead: e.target.checked }))}
                            className="h-4 w-4 accent-[#C8102E]"
                          />
                          Is shift lead
                        </label>
                        <label className="text-xs font-medium text-zinc-600 sm:col-span-2">
                          Notes
                          <textarea
                            value={editForm.notes}
                            onChange={(e) => setEditForm((s) => ({ ...s, notes: e.target.value }))}
                            rows={3}
                            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          />
                        </label>
                        <div className="sm:col-span-2 flex gap-2">
                          <button type="button" onClick={() => saveEmployeeEdit(emp.id)} className="rounded-lg bg-[#C8102E] px-3 py-2 text-xs font-semibold text-white">
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </article>
      ) : null}

      {!loading && tab === "CERTIFICATIONS" ? (
        <article className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-800">
                <tr>
                  <th className="px-2 py-2">Employee</th>
                  {STATIONS.map((station) => (
                    <th key={station} className="px-2 py-2">{station}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeEmployees.map((emp) => (
                  <tr key={emp.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-2 font-semibold">{fullName(emp)}</td>
                    {STATIONS.map((station) => {
                      const cert = certsByEmployeeStation.get(`${emp.id}::${station}`);
                      const status = cert?.status || "uncertified";
                      const icon = status === "certified" ? "✅" : status === "in_training" ? "🔄" : "➕";
                      const bg = status === "certified" ? "bg-green-100" : status === "in_training" ? "bg-yellow-100" : "bg-zinc-100";
                      const tooltip =
                        status === "certified"
                          ? `Certified: ${cert.certified_date || "unknown"}`
                          : status === "in_training"
                            ? `Trainer: ${cert.trainer_name || "unknown"}`
                            : "Tap to start training";
                      return (
                        <td key={`${emp.id}-${station}`} className="px-2 py-2">
                          <button
                            type="button"
                            title={tooltip}
                            onClick={() => setCertModal({ employee: emp, station, cert })}
                            className={`h-9 w-9 rounded-full ${bg}`}
                          >
                            {icon}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {!loading && tab === "TRAINING" ? (
        <div className="space-y-4">
          <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Currently In Training</h3>
            <div className="mt-3 grid gap-3">
              {trainingRows.length === 0 ? (
                <p className="text-sm text-zinc-500">No employees currently in training.</p>
              ) : (
                trainingRows.map((row) => (
                  <div key={`${row.cert.employee_id}-${row.cert.station}`} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="font-semibold">{fullName(row.employee)}</p>
                    <p className="text-xs text-zinc-500">
                      {row.cert.station} | Trainer: {row.cert.trainer_name || "Unassigned"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {row.days} days in training | {row.sessionCount} sessions logged
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setLogSessionTarget({ employee: row.employee, cert: row.cert });
                        setLogSessionShift("Morning");
                      }}
                      className="mt-2 rounded-lg bg-[#C8102E] px-3 py-2 text-xs font-semibold text-white"
                    >
                      Log Training Session
                    </button>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Trainer Performance</h3>
            <div className="mt-3 grid gap-3">
              {trainerCards.length === 0 ? (
                <p className="text-sm text-zinc-500">No trainer data yet.</p>
              ) : (
                trainerCards.map((card) => (
                  <div key={card.trainer.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="font-semibold">{fullName(card.trainer)}</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      Total employees trained: {card.totalEmployeesTrained} | Avg days to cert: {card.avgDays.toFixed(1)} | First-pass rate:{" "}
                      {card.firstPassRate.toFixed(1)}% | Current trainees: {card.currentTrainees}
                    </p>
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-[560px] text-xs">
                        <thead>
                          <tr className="text-zinc-500">
                            <th className="px-2 py-1 text-left">Station</th>
                            <th className="px-2 py-1 text-left">Trainees</th>
                            <th className="px-2 py-1 text-left">Avg days</th>
                            <th className="px-2 py-1 text-left">Pass rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {card.stationBreakdown.map((row) => (
                            <tr key={row.station} className="border-t border-zinc-100 dark:border-zinc-800">
                              <td className="px-2 py-1">{row.station}</td>
                              <td className="px-2 py-1">{row.trainees}</td>
                              <td className="px-2 py-1">{row.avgDays.toFixed(1)}</td>
                              <td className="px-2 py-1">{row.passRate.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      ) : null}

      {!loading && tab === "QUESTION BANK" ? (
        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500">
            Questions are randomly selected during certification tests. Add more questions to increase test coverage. All active questions will be included in every test.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <select
              value={questionStation}
              onChange={(e) => {
                setQuestionStation(e.target.value);
                setNewQuestion((s) => ({ ...s, station: e.target.value }));
              }}
              className="h-10 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {STATIONS.map((station) => (
                <option key={station} value={station}>
                  {station}
                </option>
              ))}
            </select>
            <div className="text-xs text-zinc-600">
              {stationQuestionCount.map((row) => (
                <p key={row.station}>
                  {row.station} - {row.total} questions ({row.active} active)
                </p>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-sm font-semibold">Add Question</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <select
                value={newQuestion.station}
                onChange={(e) => setNewQuestion((s) => ({ ...s, station: e.target.value }))}
                className="h-10 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                {STATIONS.map((station) => (
                  <option key={station} value={station}>
                    {station}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newQuestion.question_text}
                onChange={(e) => setNewQuestion((s) => ({ ...s, question_text: e.target.value }))}
                placeholder="Question text"
                className="h-10 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 sm:col-span-2"
              />
              <select
                value={newQuestion.category}
                onChange={(e) => setNewQuestion((s) => ({ ...s, category: e.target.value }))}
                className="h-10 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                {QUESTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={addQuestion} className="mt-2 h-10 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
              Add Question
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {stationQuestions.map((row) => (
              <div key={row.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                {editingQuestionId === row.id ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      value={questionDraft.question_text}
                      onChange={(e) => setQuestionDraft((s) => ({ ...s, question_text: e.target.value }))}
                      className="h-10 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 sm:col-span-2"
                    />
                    <select
                      value={questionDraft.category}
                      onChange={(e) => setQuestionDraft((s) => ({ ...s, category: e.target.value }))}
                      className="h-10 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      {QUESTION_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <div className="sm:col-span-3 flex gap-2">
                      <button type="button" onClick={saveQuestionEdit} className="rounded bg-[#C8102E] px-3 py-1 text-xs font-semibold text-white">
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingQuestionId(null)} className="rounded border border-zinc-300 px-3 py-1 text-xs font-semibold">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm">{row.question_text}</p>
                      <span className="mt-1 inline-block rounded bg-zinc-100 px-2 py-0.5 text-[11px] capitalize text-zinc-700">{row.category || "knowledge"}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleQuestionActive(row)}
                        className={`rounded px-2 py-1 text-xs font-semibold ${row.is_active !== false ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-600"}`}
                      >
                        {row.is_active !== false ? "Active" : "Inactive"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingQuestionId(row.id);
                          setQuestionDraft({ question_text: row.question_text || "", category: row.category || "knowledge" });
                        }}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold"
                      >
                        Edit
                      </button>
                      <button type="button" onClick={() => softDeleteQuestion(row)} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-red-700">
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {showAddEmployee ? (
        <Modal title="Add New Employee" onClose={() => setShowAddEmployee(false)}>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["first_name", "First Name *"],
              ["last_name", "Last Name *"],
              ["phone", "Phone"],
              ["email", "Email"],
            ].map(([key, label]) => (
              <label key={key} className="text-xs font-medium text-zinc-600">
                {label}
                <input
                  type="text"
                  value={addForm[key]}
                  onChange={(e) => setAddForm((s) => ({ ...s, [key]: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
            ))}
            <label className="text-xs font-medium text-zinc-600">
              Hire Date
              <input
                type="date"
                value={addForm.hire_date}
                onChange={(e) => setAddForm((s) => ({ ...s, hire_date: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Primary Role
              <select
                value={addForm.primary_role}
                onChange={(e) => setAddForm((s) => ({ ...s, primary_role: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Starting Wage *
              <input
                type="number"
                min="0"
                step="0.01"
                value={addForm.starting_wage}
                onChange={(e) => setAddForm((s) => ({ ...s, starting_wage: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Status
              <select
                value={addForm.status}
                onChange={(e) => setAddForm((s) => ({ ...s, status: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-600 sm:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(addForm.is_shift_lead)}
                onChange={(e) => setAddForm((s) => ({ ...s, is_shift_lead: e.target.checked }))}
                className="h-4 w-4 accent-[#C8102E]"
              />
              Is shift lead
            </label>
          </div>
          <button type="button" onClick={addEmployee} className="mt-3 h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
            Save Employee
          </button>
        </Modal>
      ) : null}

      {wageHistoryEmployee ? (
        <Modal title={`Wage History - ${fullName(wageHistoryEmployee)}`} onClose={() => setWageHistoryEmployee(null)}>
          <div className="overflow-x-auto">
            <table className="min-w-[640px] text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800">
                <tr>
                  <th className="px-2 py-1 text-left">Date</th>
                  <th className="px-2 py-1 text-left">Rate</th>
                  <th className="px-2 py-1 text-left">Reason</th>
                  <th className="px-2 py-1 text-left">Approved By</th>
                </tr>
              </thead>
              <tbody>
                {[...wages]
                  .filter((w) => w.employee_id === wageHistoryEmployee.id)
                  .sort((a, b) => new Date(b.effective_date || b.created_at || 0) - new Date(a.effective_date || a.created_at || 0))
                  .map((w) => (
                    <tr key={w.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-1">{w.effective_date || "—"}</td>
                      <td className="px-2 py-1">{money(w.hourly_rate)}</td>
                      <td className="px-2 py-1">{w.reason || "—"}</td>
                      <td className="px-2 py-1">{w.approved_by || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}

      {raiseEmployee ? (
        <Modal title={`Give Raise - ${fullName(raiseEmployee)}`} onClose={() => setRaiseEmployee(null)}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium text-zinc-600">
              New Hourly Rate
              <input
                type="number"
                min="0"
                step="0.01"
                value={raiseForm.new_rate}
                onChange={(e) => setRaiseForm((s) => ({ ...s, new_rate: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Effective Date
              <input
                type="date"
                value={raiseForm.effective_date}
                onChange={(e) => setRaiseForm((s) => ({ ...s, effective_date: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600 sm:col-span-2">
              Reason
              <select
                value={raiseForm.reason}
                onChange={(e) => setRaiseForm((s) => ({ ...s, reason: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                {RAISE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-600 sm:col-span-2">
              Notes
              <textarea
                value={raiseForm.notes}
                onChange={(e) => setRaiseForm((s) => ({ ...s, notes: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>
          <button type="button" onClick={giveRaise} className="mt-3 h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
            Confirm Raise
          </button>
        </Modal>
      ) : null}

      {certModal ? (
        <Modal title={`${fullName(certModal.employee)} - ${certModal.station}`} onClose={() => setCertModal(null)}>
          {!certModal.cert ? (
            <div>
              <p className="text-sm text-zinc-600">This employee has not started certification for this station.</p>
              <label className="mt-3 block text-xs font-medium text-zinc-600">
                Trainer
                <select
                  value={startTrainingTrainerId}
                  onChange={(e) => setStartTrainingTrainerId(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="">Select trainer...</option>
                  {activeTrainers.map((trainer) => (
                    <option key={trainer.id} value={trainer.id}>
                      {fullName(trainer)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => startTraining(certModal)} className="mt-3 h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
                Start Training
              </button>
            </div>
          ) : certModal.cert.status === "in_training" ? (
            <div>
              <p className="text-sm text-zinc-700">
                Trainer: <span className="font-semibold">{certModal.cert.trainer_name || "Unassigned"}</span>
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                Training start: <span className="font-semibold">{certModal.cert.training_start_date || "—"}</span> ({daysBetween(certModal.cert.training_start_date)} days)
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => beginCertificationTest(certModal)} className="h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
                  Begin Certification Test
                </button>
                <button
                  type="button"
                  onClick={() => markTrainingCompleteWithoutTest(certModal)}
                  className="h-11 rounded-lg border border-zinc-300 px-4 text-sm font-semibold"
                >
                  Mark Training Complete without test
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-zinc-700">Certified date: {certModal.cert.certified_date || "—"}</p>
              <p className="mt-1 text-sm text-zinc-700">Trainer: {certModal.cert.trainer_name || "—"}</p>
              <p className="mt-1 text-sm text-zinc-700">Certified by: {certModal.cert.certified_by || "—"}</p>
              <button
                type="button"
                onClick={() => setAttemptHistoryTarget(certModal)}
                className="mt-3 h-11 rounded-lg border border-zinc-300 px-4 text-sm font-semibold"
              >
                View Attempt History
              </button>
            </div>
          )}
        </Modal>
      ) : null}

      {attemptHistoryTarget ? (
        <Modal title={`Attempt History - ${fullName(attemptHistoryTarget.employee)} / ${attemptHistoryTarget.station}`} onClose={() => setAttemptHistoryTarget(null)}>
          <div className="space-y-2">
            {attempts
              .filter((a) => a.employee_id === attemptHistoryTarget.employee.id && a.station === attemptHistoryTarget.station)
              .sort((a, b) => new Date(b.attempted_at || 0) - new Date(a.attempted_at || 0))
              .map((a) => (
                <div key={a.id} className="rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800">
                  <p>
                    {new Date(a.attempted_at || 0).toLocaleString()} - {a.passed ? "PASS" : "FAIL"} ({a.score}/{a.total_questions})
                  </p>
                </div>
              ))}
          </div>
        </Modal>
      ) : null}

      {testFlow ? (
        <Modal title={`Certification Test - ${fullName(testFlow.employee)} / ${testFlow.station}`} onClose={() => setTestFlow(null)}>
          {testFlow.stage === "questions" ? (
            <div>
              <p className="text-xs text-zinc-500">
                Question {testFlow.idx + 1} of {testFlow.questions.length}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-zinc-200">
                <div className="h-full bg-[#C8102E]" style={{ width: `${((testFlow.idx + 1) / testFlow.questions.length) * 100}%` }} />
              </div>
              <p className="mt-4 text-base font-semibold">{testFlow.questions[testFlow.idx].question_text}</p>
              <label className="mt-3 block text-xs font-medium text-zinc-600">
                Notes (optional)
                <textarea
                  value={testFlow.noteDraft}
                  onChange={(e) => setTestFlow((s) => ({ ...s, noteDraft: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => answerTestQuestion(true)} className="h-11 rounded-lg bg-green-600 px-4 text-sm font-semibold text-white">
                  PASS
                </button>
                <button type="button" onClick={() => answerTestQuestion(false)} className="h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white">
                  FAIL
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-base font-bold">
                Score: {testFlow.answers.filter((a) => a.passed).length}/{testFlow.answers.length}
              </p>
              {testFlow.answers.some((a) => !a.passed) ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p className="font-semibold">Attempt Failed</p>
                  {testFlow.answers
                    .filter((a) => !a.passed)
                    .map((a) => (
                      <p key={a.question_id}>- {a.question_text}</p>
                    ))}
                </div>
              ) : null}

              {testFlow.answers.every((a) => a.passed) ? (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-medium text-zinc-600">
                    Trainer Signature (name)
                    <input
                      type="text"
                      value={testFlow.trainerSignature}
                      onChange={(e) => setTestFlow((s) => ({ ...s, trainerSignature: e.target.value }))}
                      className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-600">
                    <input
                      type="checkbox"
                      checked={Boolean(testFlow.gmApproved)}
                      onChange={(e) => setTestFlow((s) => ({ ...s, gmApproved: e.target.checked }))}
                      className="h-4 w-4 accent-[#C8102E]"
                    />
                    GM approval
                  </label>
                  <button type="button" onClick={() => submitCertificationAttempt(true)} className="h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
                    Certify Employee
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => submitCertificationAttempt(false)} className="h-11 rounded-lg border border-zinc-300 px-4 text-sm font-semibold">
                    Save Failed Attempt
                  </button>
                  <button type="button" onClick={() => beginCertificationTest({ employee: testFlow.employee, station: testFlow.station, cert: testFlow.cert }, true)} className="h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
                    Retake Failed Questions Only
                  </button>
                </div>
              )}
            </div>
          )}
        </Modal>
      ) : null}

      {logSessionTarget ? (
        <Modal title={`Log Training Session - ${fullName(logSessionTarget.employee)}`} onClose={() => setLogSessionTarget(null)}>
          <p className="text-sm text-zinc-700">Station: {logSessionTarget.cert?.station}</p>
          <label className="mt-3 block text-xs font-medium text-zinc-600">
            Shift
            <select
              value={logSessionShift}
              onChange={(e) => setLogSessionShift(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="Morning">Morning</option>
              <option value="Night">Night</option>
            </select>
          </label>
          <button type="button" onClick={logTrainingSession} className="mt-3 h-11 rounded-lg bg-[#C8102E] px-4 text-sm font-semibold text-white">
            Save Session
          </button>
        </Modal>
      ) : null}
    </section>
  );
}
