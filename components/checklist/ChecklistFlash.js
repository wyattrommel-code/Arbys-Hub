"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function FlashMessage() {
  const searchParams = useSearchParams();
  const flash = searchParams.get("flash");
  if (flash !== "manager-required") return null;
  return (
    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Manager access required.
    </p>
  );
}

export default function ChecklistFlash() {
  return (
    <Suspense fallback={null}>
      <FlashMessage />
    </Suspense>
  );
}
