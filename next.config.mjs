/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@mediapipe/tasks-vision"],
  async redirects() {
    return [
      { source: "/schedule/attendance", destination: "/timeclock/attendance", permanent: true },
      { source: "/schedule/timecards", destination: "/timeclock/timecards", permanent: true },
    ];
  },
};

export default nextConfig;
