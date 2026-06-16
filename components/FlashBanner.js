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
  const [activeFlash, setActiveFlash] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!flashKey) return;

    setActiveFlash(flashKey);
    setVisible(true);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("flash");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });

    const timer = setTimeout(() => {
      setVisible(false);
      setActiveFlash(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [flashKey, pathname, router, searchParams]);

  if (!activeFlash || !visible) return null;

  const message = FLASH_MESSAGES[activeFlash] || "Something went wrong.";

  return (
    <div
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
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
