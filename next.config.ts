import type { NextConfig } from "next";

// On GitHub Pages a project site is served from /<repo>, so we prefix the app
// with a base path during the CI build (PAGES_BASE_PATH is set by the deploy
// workflow). Locally this is empty, so `next dev` stays at "/".
const basePath = process.env.PAGES_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
