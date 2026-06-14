/** Primary sidebar navigation (order matters). */
export const SIDEBAR_NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/dashboard", label: "Dashboard", icon: "gauge" },
  { href: "/roast-beef", label: "Roast Beef", icon: "flame" },
  { href: "/checklist", label: "Checklists", icon: "clipboard-list", matchPrefix: true },
  { href: "/deployment", label: "Deployment", icon: "layout-grid" },
  { href: "/waste", label: "Waste", icon: "trash-2" },
  { href: "/inventory", label: "Inventory", icon: "package" },
  { href: "/schedule", label: "Schedule", icon: "calendar" },
  { href: "/people", label: "People", icon: "users" },
  { href: "/import", label: "Import", icon: "upload" },
  { href: "/reports", label: "Reports", icon: "bar-chart-3", matchPrefix: true },
  { href: "/settings", label: "Settings", icon: "settings" },
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
