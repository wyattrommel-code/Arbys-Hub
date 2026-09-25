"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FLASH_MESSAGES } from "@/lib/permissions";

function FlashBannerInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const flashKey = searchParams.get("flash");
  const [previousKey, setPreviousKey] = useState(flashKey);
  const [activeFlash, setActiveFlash] = useState(() => flashKey ? { key: flashKey, pathname } : null);

  if (flashKey !== previousKey) {
    setPreviousKey(flashKey);
    if (flashKey) setActiveFlash({ key: flashKey, pathname });
  }

  useEffect(() => {
    if (!flashKey) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("flash");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [flashKey, pathname, router, searchParams]);

  useEffect(() => {
    if (!activeFlash) return;
    const timer = setTimeout(() => {
      setActiveFlash(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [activeFlash]);

  if (!activeFlash || activeFlash.pathname !== pathname) return null;

  const message = FLASH_MESSAGES[activeFlash.key] || "Something went wrong.";

  return (
    <div
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950 print:hidden dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
      role="status"
    >
      {message}
    </div>
  );
}

export default function FlashBanner() {
  return (
    <Suspense fallback={null}>
      <FlashBannerInner />
    </Suspense>
  );
}
