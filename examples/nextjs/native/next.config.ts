import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds the app into a module that fsn build loads straight into the
  // native app's main process.
  adapterPath: require.resolve("@fsn.dev/adapter-nextjs"),
};

export default nextConfig;
