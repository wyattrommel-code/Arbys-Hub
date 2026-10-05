import test from "node:test";
import assert from "node:assert/strict";
import { adjustShiftWindow, layoutDayShifts, shiftWindow, windowFields } from "../lib/schedule-day.js";
import { assigneeFields, compareEmployees, findEmployeeForShift } from "../lib/schedule.js";

test("moving preserves length and resizing snaps to 15 minutes, subtracting the break once", () => {
  const original = { start: 540, end: 1020 };
  assert.deepEqual(adjustShiftWindow(original, "move", 22), { start: 555, end: 1035 });
  assert.deepEqual(adjustShiftWindow(original, "start", -31), { start: 510, end: 1020 });
  const longer = adjustShiftWindow(original, "end", 31);
  assert.deepEqual(windowFields(longer, 30), { scheduled_start: "09:00:00", scheduled_end: "17:30:00", scheduled_hours: 8 });
  const shorter = adjustShiftWindow(original, "end", -1000);
  assert.equal(shorter.end - shorter.start, 15);
  assert.equal(windowFields(shorter, 30).scheduled_hours, 0);
});

test("overnight shifts keep the start date and never wrap into an ambiguous full day", () => {
  const overnight = shiftWindow({ scheduled_start: "22:00:00", scheduled_end: "02:00:00" });
  assert.deepEqual(overnight, { start: 1320, end: 1560 });
  assert.deepEqual(windowFields(adjustShiftWindow(overnight, "end", 60, 1800), 30), {
    scheduled_start: "22:00:00", scheduled_end: "03:00:00", scheduled_hours: 4.5,
  });
  const moved = adjustShiftWindow(overnight, "move", 900, 1800);
  assert.equal(moved.start, 1425);
  assert.equal(moved.end - moved.start, 240);
  const extreme = adjustShiftWindow({ start: 0, end: 60 }, "end", 3000, 2880);
  assert.equal(extreme.end, 1425);
  assert.equal(adjustShiftWindow(overnight, "move", -3000, 1800).start, 0);
  assert.equal(adjustShiftWindow(overnight, "start", -3000, 1800).start, 135);
});

test("overlaps remain separately editable while adjacent shifts reuse lanes", () => {
  const shifts = [
    { id: "late", scheduled_start: "12:00", scheduled_end: "14:00" },
    { id: "early", scheduled_start: "09:00", scheduled_end: "12:00" },
    { id: "overlap", scheduled_start: "11:00", scheduled_end: "13:00" },
  ];
  assert.deepEqual(layoutDayShifts(shifts).map(({ shift, lane }) => [shift.id, lane]), [["early", 0], ["overlap", 1], ["late", 0]]);
  assert.equal(shifts[0].id, "late", "do not mutate the caller's shift array");
});

test("same-last-name moves and copies stay on their target employee and sort by first name", () => {
  const dawson = { id: "dawson", fullName: "Dawson Campbell", first_name: "Dawson", jolt_employee_id: null };
  const jared = { id: "jared", fullName: "Jared Campbell", first_name: "Jared", jolt_employee_id: null };
  const source = { id: "original", employee_id: jared.id, employee_name: jared.fullName, scheduled_start: "09:00", scheduled_end: "17:00", unpaid_break_minutes: 30 };
  const next = { ...source, ...assigneeFields(dawson), ...windowFields({ start: 600, end: 1080 }, source.unpaid_break_minutes) };
  assert.equal(findEmployeeForShift([jared, dawson], next), dawson);
  assert.equal(next.scheduled_hours, 7.5);
  assert.equal(source.employee_id, jared.id);
  assert.deepEqual([jared, dawson].sort(compareEmployees).map((employee) => employee.id), ["dawson", "jared"]);
});
