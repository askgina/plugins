import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { evalPublicArtifactsPlugin } from "../../tools/check-eval-public-artifacts";

export default defineConfig({
  plugins: [evalPublicArtifactsPlugin(), react()],
  build: {
    outDir: "dist/app",
  },
});
