export const metadata = {
  title: "Roast beef daily sheet · Arby's Ops",
  description: "Roast beef daily sheet with Supabase sync",
};

export default function RoastBeefPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-100 dark:bg-zinc-950">
      <iframe
        title="Roast beef daily sheet"
        src="/roast-beef/embed"
        className="min-h-0 w-full flex-1 border-0"
      />
    </div>
  );
}
