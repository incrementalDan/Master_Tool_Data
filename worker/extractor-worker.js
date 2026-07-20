/**
 * ToolDex — Claude extraction relay (Cloudflare Worker)
 * ---------------------------------------------------------------------------
 * This is the little "doorman" that holds your Anthropic API key.
 *
 * The app (in the browser) sends a tool screenshot / PDF / text to THIS relay.
 * The relay adds your secret API key, forwards the request to Anthropic,
 * and passes the answer back. The key never leaves Cloudflare, so it can
 * never be stolen from the public website.
 *
 * The key itself is NOT in this file. It lives in Cloudflare's secret store
 * under the name ANTHROPIC_API_KEY (you add it in the dashboard — see
 * docs/EXTRACTOR_SETUP.md, Step 4). The code reads it as `env.ANTHROPIC_API_KEY`.
 *
 * This same Worker becomes the Phase A "doorman" later — the login endpoints
 * just get added alongside this one. Nothing here is throwaway.
 */

// Which website(s) are allowed to use this relay. This stops a random other
// website from calling it through a visitor's browser. Add your local dev
// address if you ever run the app on your own machine.
const ALLOWED_ORIGINS = [
  "https://incrementaldan.github.io", // the live app on GitHub Pages
  "http://localhost:5173",            // local development (optional)
];

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 2048;

function corsHeaders(origin) {
  // Echo the caller's origin back if it's on our list, otherwise fall back
  // to the main one. This is what lets the browser accept the reply.
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    // Browsers send a "preflight" OPTIONS request first to ask permission.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST" }, 405, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      // You forgot to add the secret in Cloudflare (Step 4).
      return json({ error: "Server is missing ANTHROPIC_API_KEY" }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be JSON" }, 400, cors);
    }

    // The app sends model / max_tokens / system / messages already shaped for
    // Anthropic. We fill in sensible defaults if any are missing.
    const payload = {
      model: body.model || DEFAULT_MODEL,
      max_tokens: body.max_tokens || DEFAULT_MAX_TOKENS,
      system: body.system,
      messages: body.messages,
    };

    let apiRes;
    try {
      apiRes = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ error: "Could not reach Anthropic: " + e.message }, 502, cors);
    }

    // Pass Anthropic's answer straight back to the app, untouched.
    const text = await apiRes.text();
    return new Response(text, {
      status: apiRes.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  },
};
