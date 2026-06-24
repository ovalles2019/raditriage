// Minimal production server: serves the built SPA from /dist and exposes the
// same /api/claude proxy used in development. Binds 0.0.0.0:$PORT so it runs
// cleanly on managed platforms.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleClaude } from "./claude.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const apiKey = process.env.ANTHROPIC_API_KEY || "";
const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
const port = process.env.PORT || 3000;

app.post("/api/claude", (req, res) => handleClaude(req, res, { apiKey, model }));

const dist = path.resolve(__dirname, "..", "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`RadiTriage listening on http://0.0.0.0:${port}`);
});
