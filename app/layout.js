import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { connection } from "next/server";
import AppShell from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Arby's Ops",
  description: "Store operations",
};

export default async function RootLayout({ children }) {
  // The clock deployment has no Hub credentials and serves only runtime-gated routes.
  if (process.env.CLOCK_ONLY === "true") await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {process.env.CLOCK_ONLY === "true" ? children : <AppShell>{children}</AppShell>}
      </body>
    </html>
  );
}
