"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ScheduleToast from "@/components/schedule/ScheduleToast";
import { employeeFullName, fetchEmployees } from "@/lib/employees";
import { DAY_LABELS, formatClock, formatLongDate, SCHEDULE_STORE_ID } from "@/lib/schedule";
import { getSupabase } from "@/lib/supabase";

export default function ManageAvailability({ reviewerName }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [employees, setEmployees] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [requests, setRequests] = useState([]);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const employeeRows = await fetchEmployees(supabase, {
        select: "id, first_name, last_name, role, is_shift_lead",
      });
      const mapped = (employeeRows || []).map((row) => ({ ...row, fullName: employeeFullName(row) }));
      const ids = mapped.map((e) => e.id);
      const [{ data: avail, error: availErr }, { data: toRows, error: toErr }] = await Promise.all([
        ids.length
          ? supabase.from("employee_availability").select("*").in("employee_id", ids)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("time_off_requests")
          .select("*")
          .eq("store_id", SCHEDULE_STORE_ID)
          .order("start_date", { ascending: false }),
      ]);
      if (availErr) throw availErr;
      if (toErr) throw toErr;
      setEmployees(mapped);
      setAvailability(avail || []);
      setRequests(toRows || []);
    } catch (err) {
      showToast(err?.message || "Could not load availability.");
    } finally {
      setLoading(false);
    }
  }, [showToast, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function cellFor(empId, day) {
    return availability.find((row) => row.employee_id === empId && Number(row.day_of_week) === day);
  }

  async function review(request, status) {
    const { error } = await supabase
      .from("time_off_requests")
      .update({
        status,
        reviewed_by: reviewerName || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    if (error) {
      showToast(error.message || "Could not update request.");
      return;
    }
    showToast(`Request ${status}.`, "success");
    load();
  }

  const pending = requests.filter((r) => r.status === "pending");
  const others = requests.filter((r) => r.status !== "pending");

  return (
    <section className="mx-auto flex w-full flex-1 flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-xl font-semibold">Manage Availability</h2>
        <p className="text-sm text-zinc-500">Warnings only — this never blocks the builder.</p>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-bold text-[#C8102E]">Time-off requests</h3>
        {pending.length + others.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No requests yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {[...pending, ...others].map((req) => (
              <li
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
              >
                <div>
                  <p className="font-semibold">{req.employee_name}</p>
                  <p className="text-xs text-zinc-500">
                    {formatLongDate(req.start_date)} → {formatLongDate(req.end_date)} · {req.reason || "No reason"} · {req.status}
                  </p>
                </div>
                {req.status === "pending" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => review(req, "approved")}
                      className="rounded-md bg-green-700 px-2 py-1 text-xs font-semibold text-white"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => review(req, "denied")}
                      className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"
                    >
                      Deny
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading availability…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <table className="min-w-[720px] w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="px-3 py-2">Employee</th>
                {DAY_LABELS.map((day) => (
                  <th key={day} className="px-3 py-2">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-semibold">{emp.fullName}</td>
                  {DAY_LABELS.map((_, day) => {
                    const cell = cellFor(emp.id, day);
                    if (!cell) {
                      return (
                        <td key={day} className="px-3 py-2 text-zinc-400">
                          —
                        </td>
                      );
                    }
                    if (cell.is_available === false) {
                      return (
                        <td key={day} className="px-3 py-2 font-semibold text-red-700">
                          Off
                        </td>
                      );
                    }
                    if (cell.available_start && cell.available_end) {
                      return (
                        <td key={day} className="px-3 py-2">
                          {formatClock(cell.available_start)}–{formatClock(cell.available_end)}
                        </td>
                      );
                    }
                    return (
                      <td key={day} className="px-3 py-2 text-green-700">
                        Open
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ScheduleToast toast={toast} />
    </section>
  );
}
