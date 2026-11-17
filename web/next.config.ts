import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds a plain static site for GitHub Pages (served under /<repo>/ via BASE_PATH).
// Otherwise the build is a self-contained Node server for Docker.
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : { output: "standalone" }),
  basePath,
  poweredByHeader: false,
  // Partial prerendering needs a server, so it is off for the static GitHub Pages build.
  cacheComponents: !staticExport,
  partialPrefetching: !staticExport,
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
