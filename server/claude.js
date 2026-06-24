// Framework-agnostic Anthropic proxy handler.
// Shared by the Vite dev middleware (vite.config.js) and the production
// Express server (server/index.js). The API key stays server-side; the
// browser only ever talks to /api/claude.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
      return resolve(req.body);
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}

export async function handleClaude(req, res, { apiKey, model }) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON body" });
  }

  // No key configured -> tell the client to use Demo mode instead of failing hard.
  if (!apiKey) {
    return sendJSON(res, 503, {
      error: "No ANTHROPIC_API_KEY configured on the server. Use Demo mode, or set the key to enable live AI.",
      demo: true,
    });
  }

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: body.max_tokens || 1100,
        system: body.system || "",
        messages: [{ role: "user", content: body.user || "" }],
      }),
    });
    const data = await upstream.json();
    return sendJSON(res, upstream.status, data);
  } catch (err) {
    return sendJSON(res, 502, { error: "Upstream Anthropic request failed", detail: String(err) });
  }
}
