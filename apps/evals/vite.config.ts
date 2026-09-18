import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { evalPublicArtifactsPlugin } from "../../tools/check-eval-public-artifacts";
import { evalConversationsPlugin } from "../../tools/eval-conversations";

export default defineConfig({
  plugins: [evalPublicArtifactsPlugin(), evalConversationsPlugin(), react()],
  build: {
    outDir: "dist/app",
  },
});
