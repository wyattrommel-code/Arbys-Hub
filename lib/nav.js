/** Primary sidebar navigation (order matters). */
export const SIDEBAR_NAV = [
  { href: "/", label: "Home", icon: "home", feature: "home" },
  { href: "/dashboard", label: "Dashboard", icon: "gauge", feature: "dashboard" },
  { href: "/roast-beef", label: "Roast Beef", icon: "flame", feature: "roast_beef" },
  { href: "/checklist", label: "Checklists", icon: "clipboard-list", matchPrefix: true, feature: "checklists.complete" },
  { href: "/deployment", label: "Deployment", icon: "layout-grid", feature: "deployment.view" },
  { href: "/waste", label: "Waste", icon: "trash-2", feature: "waste.submit" },
  { href: "/inventory", label: "Inventory", icon: "package", feature: "inventory.view_edit" },
  { href: "/schedule", label: "Schedule", icon: "calendar", feature: "schedule.own" },
  { href: "/people", label: "People", icon: "users", feature: "people" },
  { href: "/import", label: "Import", icon: "upload", feature: "import" },
  { href: "/reports", label: "Reports", icon: "bar-chart-3", matchPrefix: true, feature: "reports" },
  { href: "/settings", label: "Settings", icon: "settings", feature: "settings" },
];

export const PAGE_TITLES = {
  "/": "Home",
  "/login": "Login",
  "/import": "Import",
  "/waste": "Waste Tracker",
  "/inventory": "Inventory",
  "/dashboard": "Dashboard",
  "/reports": "Reports",
  "/schedule": "Schedule & Attendance",
  "/deployment": "Deployment Chart",
  "/people": "People",
  "/roast-beef": "Roast Beef",
  "/roast": "Roast Beef",
  "/checklist": "Checklist",
  "/checklist/manage": "Manage Checklist",
  "/reports/checklist": "Checklist Reports",
  "/settings": "Settings",
};

export function titleForPath(pathname) {
  if (!pathname) return "Arby's Ops";
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  return "Arby's Ops";
}

export function isNavActive(pathname, item) {
  if (!pathname) return false;
  if (item.href === "/") return pathname === "/";
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}
