"use client";

import { useSyncExternalStore } from "react";
import { RAIL_STORAGE_KEY, SIDEBAR_NAV, subnavStorageKey } from "@/lib/nav";

const CHANGE_EVENT = "hub-navigation-preferences";
const groups = SIDEBAR_NAV.filter((item) => item.groups?.length);
const keys = [RAIL_STORAGE_KEY, ...groups.map((item) => subnavStorageKey(item.href))];
const fallback = new Map();

function read(key) {
  if (fallback.has(key)) return fallback.get(key);
  try {
    return window.localStorage.getItem(key);
  } catch {
    return fallback.get(key) ?? null;
  }
}

function getSnapshot() {
  // A primitive snapshot stays stable until a stored preference actually changes.
  return JSON.stringify(keys.map(read));
}

function getServerSnapshot() {
  return JSON.stringify(keys.map(() => null));
}

function subscribe(listener) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function setNavigationPreference(key, value) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
    fallback.delete(key);
  } catch {
    // Navigation still works for this session when browser storage is blocked.
    fallback.set(key, value ? "1" : "0");
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useNavigationPreferences(pathname) {
  const values = JSON.parse(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot));
  return {
    railCollapsed: values[0] === "1",
    openByHref: Object.fromEntries(groups.map((item, index) => [
      item.href,
      values[index + 1] === "1" || (values[index + 1] !== "0" &&
        (pathname === item.href || pathname.startsWith(`${item.href}/`))),
    ])),
  };
}
