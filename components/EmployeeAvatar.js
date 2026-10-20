"use client";

import Image from "next/image";
import { initialsFromName } from "@/lib/avatars";

export default function EmployeeAvatar({ name, src, size = "md", className = "" }) {
  const initials = initialsFromName(name);
  const dimension = size === "xl" ? 96 : size === "lg" ? 64 : size === "sm" ? 36 : 48;
  const px = size === "xl" ? "h-24 w-24 text-2xl" : size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-9 w-9 text-xs" : "h-12 w-12 text-sm";
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={dimension}
        height={dimension}
        unoptimized // Private photos must be fetched by the signed-in browser, not the image optimizer.
        className={`shrink-0 rounded-full object-cover ${px} ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#C8102E] font-bold text-white ${px} ${className}`}
    >
      {initials}
    </span>
  );
}
