import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth";

export async function GET() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ employee: null }, { status: 401 });
  }
  return NextResponse.json({ employee });
}
