import { NextResponse } from "next/server";
import { STORE_ID } from "@/lib/constants";
import { fetchEmployeeByPin } from "@/lib/employees";
import { getSupabaseServer } from "@/lib/supabase-server";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";

export async function POST(request) {
  try {
    const body = await request.json();
    const pin = String(body.pin || "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ ok: false, error: "Invalid PIN format" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const employee = await fetchEmployeeByPin(supabase, pin, STORE_ID);

    if (!employee) {
      return NextResponse.json({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const sessionEmployee = {
      employee_id: employee.id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      role: employee.role,
    };

    const token = await createSessionToken(sessionEmployee);
    const response = NextResponse.json({ ok: true, employee: sessionEmployee });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "Login failed" },
      { status: 500 }
    );
  }
}
