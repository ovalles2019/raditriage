# RadiTriage — AI Radiology Workflow Assistant

A platform-engineering demo of an AI radiology report pipeline for veterinary
imaging. It is **not** a diagnostic model — it's the orchestration, triage,
RBAC, and internal-tooling layer *around* one.

> Built as an interview demo. AI triage and report drafting are **preliminary**
> and would always require board-certified radiologist review before clinical use.

## What it demonstrates

- **Agentic triage pipeline** — a 4-stage flow: classify urgency → retrieve
  similar prior cases (RAG) → draft a structured preliminary report → route to
  the specialist queue, with a live execution log.
- **RBAC** — role-gated views for **Vet / Radiologist / Admin**. The UI is
  gated by the same role an API would enforce server-side.
- **RAG addendum Q&A** — trackable follow-up questions answered from the
  generated report's context.
- **Observability** — an SLA / queue / throughput ops dashboard echoing a
  35-minute STAT turnaround guarantee.
- **A real service boundary** — the browser never holds an API key; AI calls go
  through a server-side `/api/claude` proxy.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL (default http://localhost:5173). It starts in
**Demo mode**, which uses a deterministic offline engine — no API key or network
required, so it always works for a live demo.

### Optional: Live AI

Flip the **Live AI** toggle in the top bar to route calls through Anthropic.
First, provide a key:

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=...
npm run dev
```

If the key is missing or the call fails, the app automatically falls back to the
demo engine and shows a notice — the demo never hard-breaks.

## Production build

```bash
npm run build   # outputs static assets to dist/
npm start       # serves dist/ + /api/claude on 0.0.0.0:$PORT (default 3000)
```

## Deploy to Render

A [`render.yaml`](./render.yaml) Blueprint is included. To deploy:

1. In the Render dashboard: **New → Blueprint**, then connect this repo.
2. Render reads `render.yaml` and provisions a Node **web service** (`npm ci && npm run build` → `npm start`, bound to `0.0.0.0:$PORT`).
3. Click **Apply**. The service comes up in **Demo mode** with no secrets needed — the shareable URL works immediately.
4. (Optional) To enable Live AI, add `ANTHROPIC_API_KEY` in the service's **Environment** settings. It is marked `sync: false`, so it's never committed.

Make sure the branch Render syncs (the repo's default branch, or one you select)
contains `render.yaml`. The Blueprint provisions a **`starter`** instance so the
service stays always-on (no spin-down). Switch `plan` to `free` if you want the
free tier (which sleeps after ~15 min idle), or to `standard`/`pro` for more
resources.

## Architecture

```
Browser (React)
  └── src/api.js ──► POST /api/claude ──► server/claude.js ──► Anthropic API
        │                (Node proxy, key stays server-side)
        └── mockEngine.js (Demo mode + graceful fallback)
```

| Path                | Role                                                        |
| ------------------- | ----------------------------------------------------------- |
| `src/RadiTriage.jsx`| UI, pipeline orchestration, RBAC gating                     |
| `src/api.js`        | AI entry point; demo vs live routing + fallback             |
| `src/mockEngine.js` | Deterministic offline responses                             |
| `server/claude.js`  | Framework-agnostic Anthropic proxy handler                  |
| `server/index.js`   | Production Express server (static + proxy)                  |
| `vite.config.js`    | Dev server + `/api/claude` middleware                       |

## Tech stack

React 18 · Vite · lucide-react · Express (prod server). No diagnostic ML — the
clinical content is illustrative seed data.
