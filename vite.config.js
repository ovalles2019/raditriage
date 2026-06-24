import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleClaude } from "./server/claude.js";

// The Claude proxy runs as dev-server middleware so a single `npm run dev`
// serves both the UI and the (optional) live AI endpoint. The Anthropic key
// is read server-side only and never shipped to the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  const model =
    env.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  return {
    plugins: [
      react(),
      {
        name: "raditriage-claude-proxy",
        configureServer(server) {
          server.middlewares.use("/api/claude", (req, res) => {
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.end("Method Not Allowed");
              return;
            }
            handleClaude(req, res, { apiKey, model });
          });
        },
      },
    ],
    server: { port: 5173 },
  };
});
