"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import FlashBanner from "@/components/FlashBanner";
import Sidebar from "@/components/Sidebar";
import { RAIL_STORAGE_KEY } from "@/lib/nav";

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isKiosk = pathname === "/login" || pathname === "/clock";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleMobile = useCallback(() => setMobileOpen((o) => !o), []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (window.localStorage.getItem(RAIL_STORAGE_KEY) === "1") {
      setRailCollapsed(true);
    }
  }, []);

  const toggleRail = useCallback(() => {
    setRailCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    if (isKiosk) return;
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen, isKiosk]);

  if (isKiosk) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh">
      <Sidebar
        mobileOpen={mobileOpen}
        onClose={closeMobile}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRail}
      />
      <div
        className={`flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200 ease-out motion-reduce:transition-none print:pl-0 ${
          railCollapsed ? "md:pl-16" : "md:pl-60"
        }`}
      >
        <AppHeader onMenuToggle={toggleMobile} menuOpen={mobileOpen} />
        <FlashBanner />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
