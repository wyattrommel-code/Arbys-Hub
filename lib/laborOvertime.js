const OVERTIME_THRESHOLD_HOURS = 40;
const OVERTIME_MULTIPLIER = 1.5;

function toDateStr(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getWeekStartSunday(dateInput) {
  const day = new Date(`${toDateStr(dateInput)}T00:00:00`);
  day.setDate(day.getDate() - day.getDay());
  return toDateStr(day);
}

export function getWeekEndSaturday(weekStartDateStr) {
  const d = new Date(`${weekStartDateStr}T00:00:00`);
  d.setDate(d.getDate() + 6);
  return toDateStr(d);
}

function hoursNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

export function calculateOvertimeForWeekRows(rows) {
  const sorted = [...rows].sort((a, b) => {
    const aIn = new Date(a.clock_in || `${a.log_date}T00:00:00`).getTime();
    const bIn = new Date(b.clock_in || `${b.log_date}T00:00:00`).getTime();
    return aIn - bIn;
  });

  let runningHours = 0;
  return sorted.map((row) => {
    const totalHours = hoursNum(row.total_hours ?? row.hours);
    const hourlyWage = hoursNum(row.hourly_wage ?? row.wage);
    const regularCapacity = Math.max(0, OVERTIME_THRESHOLD_HOURS - runningHours);
    const regularHours = Math.min(totalHours, regularCapacity);
    const overtimeHours = Math.max(0, totalHours - regularHours);
    const regularCost = roundMoney(regularHours * hourlyWage);
    const overtimeCost = roundMoney(overtimeHours * hourlyWage * OVERTIME_MULTIPLIER);
    const shiftCost = roundMoney(regularCost + overtimeCost);
    runningHours += totalHours;
    return {
      id: row.id,
      regular_hours: regularHours,
      overtime_hours: overtimeHours,
      regular_cost: regularCost,
      overtime_cost: overtimeCost,
      shift_cost: shiftCost,
      week_start_date: row.week_start_date || getWeekStartSunday(row.log_date),
    };
  });
}
