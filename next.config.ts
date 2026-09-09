import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "210mb",
    },
  },
  // Keep Transformers.js / ONNX out of the webpack bundle (Node runtime only)
  serverExternalPackages: [
    "@xenova/transformers",
    "onnxruntime-node",
    "sharp",
  ],
};

export default nextConfig;
