import { mockClaude } from "./mockEngine.js";

const DEMO_LATENCY_MS = 550;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Single entry point for "AI" calls.
// - mode "demo": deterministic offline responses (no network, no key).
// - mode "live": calls the server-side /api/claude proxy. If that fails for
//   any reason, it falls back to the demo engine so the demo never breaks,
//   and reports the error via onLiveError so the UI can surface a notice.
export async function callClaude(systemPrompt, userContent, maxTokens = 1100, mode = "demo", onLiveError) {
  if (mode === "demo") {
    await delay(DEMO_LATENCY_MS);
    return mockClaude(systemPrompt, userContent);
  }

  try {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: systemPrompt, user: userContent, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const info = await res.json().catch(() => ({}));
      throw new Error(info.error || `Proxy responded ${res.status}`);
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("Empty response from model");
    return text;
  } catch (err) {
    if (onLiveError) onLiveError(err);
    await delay(200);
    return mockClaude(systemPrompt, userContent);
  }
}
