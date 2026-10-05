/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.CLOCK_ONLY === "true" ? ".next-clock" : ".next",
  serverExternalPackages: ["@mediapipe/tasks-vision"],
  async headers() {
    return [{ source: "/clock-sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] }, { source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
    ] }];
  },
  async redirects() {
    return [
      { source: "/schedule/attendance", destination: "/timeclock/attendance", permanent: true },
      { source: "/schedule/timecards", destination: "/timeclock/timecards", permanent: true },
    ];
  },
};

export default nextConfig;
