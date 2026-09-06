"use client";

export default function ScheduleToast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === "error";
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${
        isError
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/80 dark:text-red-100"
          : "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/80 dark:text-green-100"
      }`}
    >
      {toast.message}
    </div>
  );
}
