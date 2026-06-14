"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import Sidebar from "@/components/Sidebar";

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleMobile = useCallback(() => setMobileOpen((o) => !o), []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isLogin) return;
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen, isLogin]);

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh">
      <Sidebar mobileOpen={mobileOpen} onClose={closeMobile} />
      <div className="flex min-h-dvh min-w-0 flex-col md:pl-60">
        <AppHeader onMenuToggle={toggleMobile} menuOpen={mobileOpen} />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
