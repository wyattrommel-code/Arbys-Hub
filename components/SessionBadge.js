"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function SessionBadge() {
  const pathname = usePathname();
  const router = useRouter();
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/clock") {
      return;
    }
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { employee: null }))
      .then((data) => { if (!cancelled) setEmployee(data.employee); })
      .catch(() => { if (!cancelled) setEmployee(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pathname]);

  const switchUser = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }, [router]);

  if (pathname === "/login" || pathname === "/clock" || loading || !employee) {
    return <div className="min-w-[80px]" aria-hidden="true" />;
  }

  return (
    <div className="flex min-w-[80px] flex-col items-end gap-0.5 text-right text-[10px] leading-tight sm:text-xs">
      <span className="truncate font-medium">Logged in as: {employee.first_name}</span>
      <button
        type="button"
        onClick={switchUser}
        className="rounded border border-white/30 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-white/15 sm:text-xs"
      >
        Switch user
      </button>
    </div>
  );
}
