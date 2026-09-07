/** Primary sidebar navigation (order matters). */
export const SIDEBAR_NAV = [
  { href: "/", label: "Home", icon: "home", feature: "home" },
  { href: "/dashboard", label: "Dashboard", icon: "gauge", feature: "dashboard" },
  { href: "/roast-beef", label: "Roast Beef", icon: "flame", feature: "roast_beef" },
  { href: "/checklist", label: "Checklists", icon: "clipboard-list", matchPrefix: true, feature: "checklists.complete" },
  { href: "/deployment", label: "Deployment", icon: "layout-grid", feature: "deployment.view" },
  { href: "/waste", label: "Waste", icon: "trash-2", feature: "waste.submit" },
  { href: "/inventory", label: "Inventory", icon: "package", feature: "inventory.view_edit" },
  {
    href: "/schedule",
    label: "Scheduling",
    icon: "calendar",
    matchPrefix: true,
    feature: "schedule.own",
    groups: [
      {
        title: "Manage",
        feature: "schedule.full",
        items: [
          { href: "/schedule/builder", label: "Schedule Builder" },
          { href: "/schedule/stations", label: "Stations" },
          { href: "/schedule/availability", label: "Manage Availability" },
          { href: "/schedule/attendance", label: "Attendance" },
          { href: "/schedule/timecards", label: "Timecards" },
          { href: "/schedule/offers", label: "Shift Offers" },
        ],
      },
      {
        title: "Your Schedule",
        feature: "schedule.own",
        items: [
          { href: "/clock", label: "Time Clock" },
          { href: "/schedule/me", label: "Shifts" },
          { href: "/schedule/me/availability", label: "Availability" },
          { href: "/schedule/me/time-off", label: "Time Off" },
        ],
      },
    ],
  },
  { href: "/people", label: "People", icon: "users", feature: "people" },
  { href: "/import", label: "Import", icon: "upload", feature: "import" },
  { href: "/reports", label: "Reports", icon: "bar-chart-3", matchPrefix: true, feature: "reports" },
  { href: "/settings", label: "Settings", icon: "settings", feature: "settings" },
];

export const PAGE_TITLES = {
  "/": "Home",
  "/clock": "Time Clock",
  "/import": "Import",
  "/waste": "Waste Tracker",
  "/inventory": "Inventory",
  "/dashboard": "Dashboard",
  "/reports": "Reports",
  "/schedule": "Scheduling",
  "/schedule/builder": "Schedule Builder",
  "/schedule/stations": "Stations",
  "/schedule/availability": "Manage Availability",
  "/schedule/attendance": "Attendance",
  "/schedule/timecards": "Timecards",
  "/schedule/offers": "Shift Offers",
  "/schedule/me": "My Shifts",
  "/schedule/me/availability": "My Availability",
  "/schedule/me/time-off": "Time Off",
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
  const keys = Object.keys(PAGE_TITLES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (key !== "/" && pathname.startsWith(`${key}/`)) return PAGE_TITLES[key];
  }
  return "Arby's Ops";
}

export function isNavActive(pathname, item) {
  if (!pathname) return false;
  if (item.href === "/") return pathname === "/";
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}

export function isScheduleChildActive(pathname, href) {
  if (!pathname || !href) return false;
  if (href === "/schedule/me") return pathname === "/schedule/me";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const RAIL_STORAGE_KEY = "hub-nav-collapsed";
export const SCHEDULE_SUBNAV_STORAGE_KEY = "hub-schedule-subnav-open";
