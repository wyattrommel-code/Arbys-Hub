import Link from "next/link";

const nav = [
  { href: "/waste", label: "Waste" },
  { href: "/inventory", label: "Inventory" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/roast-beef", label: "Roast beef (fullscreen)" },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-center text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl dark:text-zinc-50">
          Arby&apos;s Ops
        </h1>
        <p className="mt-1 text-center text-xs text-zinc-600 dark:text-zinc-400">
          Roast beef sheet below; other sections open in their own pages.
        </p>
      </header>

      <nav
        className="flex flex-wrap items-center justify-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
        aria-label="Other sections"
      >
        {nav.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-700 sm:text-sm"
          >
            {label}
          </Link>
        ))}
      </nav>

      <main className="flex min-h-[min(100dvh,900px)] flex-1 flex-col">
        <h2 className="sr-only">Roast beef daily sheet</h2>
        <iframe
          title="Roast beef daily sheet"
          src="/roast-beef/embed"
          className="min-h-0 w-full flex-1 border-0"
        />
      </main>
    </div>
  );
}
