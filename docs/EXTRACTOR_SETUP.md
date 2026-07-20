# Extractor Setup — Get the AI "Add Tool from a picture" working

**Goal:** make the *Extract* button (under **Add New Tool**) actually read a
screenshot / PDF / product page and fill in the tool fields.

**Why it needs setup:** that button asks Claude to read the image. Claude costs
money per use, so it needs a secret key. A secret key can **never** live in the
website itself (anyone visiting could copy it and spend your money). So we put
the key inside a tiny helper on Cloudflare — a **"doorman"** — and the website
talks to the doorman instead. The doorman adds the key in private.

> This is the **same doorman** the bigger Phase A plan builds for login. We're
> just standing it up early with one job (the extractor). None of this work is
> wasted — Phase A adds more doors to the same doorman later.

---

## The shape of it (read once, then forget)

```
  Your browser  ──sends the picture──▶  Doorman (Cloudflare)  ──adds secret key──▶  Claude
  (the website)                          your key lives here                        (Anthropic)
       ▲                                                                               │
       └───────────────────  filled-in tool fields come back  ◀──────────────────────┘
```

You are going to: get a key, create the doorman, put the key inside it, and
hand me the doorman's web address. **I do all the code** — you do the clicking
that only an account owner can do. There is **no coding on your end** and (in
the simple path below) **no terminal / black command window** either.

---

## Before you start — what you'll need

- About **30–45 minutes**, unhurried.
- A **credit/debit card** for the Anthropic account (you'll load a small
  amount — see the cost note at the bottom; it's a few dollars, not a
  subscription).
- These two websites, which you'll make free accounts on:
  - **Anthropic Console** — where the key comes from: <https://console.anthropic.com>
  - **Cloudflare** — where the doorman lives: <https://dash.cloudflare.com>

> **Heads up on button names:** these websites change their layout from time to
> time, so a button might be named slightly differently than written here. I'll
> describe *what you're looking for* so you can find the nearest match. If you
> get stuck on any step, stop and tell me what you see on screen — that's
> normal and expected, not a mistake.

---

# PART A — Your steps

Do these in order. The little indented notes explain *why* — skim or skip them.

### ☐ Step 1 — Get an Anthropic API key and add a little credit

1. Go to <https://console.anthropic.com> and sign up (or sign in).
   > *This is a SEPARATE account from your Claude.ai subscription — it's the
   > "pay per use" side. They don't share a balance; that's just how Anthropic
   > set it up.*
2. Add a small amount of credit: look for **Billing** (usually under
   **Settings**), add a payment method, and load **$5** to start.
   > *Extraction is cheap — a few dollars lasts a very long time (see the cost
   > note at the bottom). Loading a fixed amount is also your safety cap: the
   > key can never spend more than the balance you put in.*
3. Find **API Keys** (under **Settings**), click **Create Key**, give it a name
   like `tooldex-extractor`, and **copy the key**. It starts with `sk-ant-`.
   > *You only see the full key once. Paste it somewhere safe for the next few
   > minutes (a temporary note). You'll hand it to Cloudflare in Step 4, then
   > you can delete your copy.*

⚠️ **Never** paste this key into the app, the repo, a chat message, an email, or
anywhere public. It only ever goes into Cloudflare (Step 4). If it ever leaks,
open the console and delete/regenerate it — no harm done.

### ☐ Step 2 — Create a free Cloudflare account

1. Go to <https://dash.cloudflare.com> and sign up (free — no card needed for
   this part).
2. Confirm your email if it asks.
   > *Cloudflare is where the doorman will live. The free tier is far more than
   > enough for this.*

### ☐ Step 3 — Create the doorman (a "Worker") and paste in its code

1. In the Cloudflare dashboard, find **Workers & Pages** in the left menu.
2. Click **Create application** → **Create Worker** (a plain Worker, *not* a
   Pages project).
3. Give it a name, e.g. `tooldex-extractor`. Click **Deploy**.
   > *This deploys an empty starter Worker just to create it. We replace its
   > code next.*
4. Click **Edit code** (or **`</>` Edit**). You'll see a code editor with some
   starter text.
5. **Delete everything** in that editor, then **paste in the entire code block**
   from the file `worker/extractor-worker.js` in this repo (I wrote it for you —
   it's also printed at the bottom of this guide for easy copying).
6. Click **Deploy** (top right).
   > *That's the doorman's brain installed. It still needs the key, next.*

### ☐ Step 4 — Put your API key inside the doorman (this is the secure part)

1. Go back to your Worker's page → **Settings** → look for **Variables and
   Secrets** (may be called **Variables**).
2. Add a new one. When it asks the *type*, choose **Secret** (sometimes shown as
   **Encrypt** / **Add secret**) — **not** a plain text variable.
3. Set:
   - **Name:** `ANTHROPIC_API_KEY`  ← must be exactly this, all caps
   - **Value:** paste the `sk-ant-…` key from Step 1
4. **Save / Deploy.**
   > *Choosing "Secret" means Cloudflare hides the value even from you after
   > this — that's what makes it safe. The doorman's code reads it privately by
   > that exact name.*
5. Now you can **delete** your temporary copy of the key from Step 1.

### ☐ Step 5 — Grab the doorman's web address

1. On the Worker's main page, find its URL. It looks like:
   `https://tooldex-extractor.YOUR-NAME.workers.dev`
2. **Copy it.**

### ☐ Step 6 — (Optional) quick check that the doorman is alive

- Paste the URL into a new browser tab and press Enter.
- ✅ **Good sign:** you see a short message like `{"error":"Use POST"}`. That
  means the doorman is up — it's just refusing because a browser visit isn't a
  proper request. Perfect.
- ❌ **Bad sign:** an error page that won't load at all → the deploy didn't
  finish; tell me and we'll sort it.

### ☐ Step 7 — Send me the doorman's URL

Paste the `…workers.dev` address to me in chat. **That's your part done.**

---

# PART B — My steps (after you send the URL)

You don't do these — they're listed so you can see the whole path.

### ☐ Step 8 — Point the app's Extract button at your doorman
> *I change one line in `tool-extractor.tsx` so the button calls your doorman
> instead of calling Anthropic directly (which is why it does nothing today),
> and I refresh the AI model it uses to a current one.*

### ☐ Step 9 — Add the doorman's URL as a build setting
> *The app needs to know the doorman's address. The URL is safe to expose (it's
> just a P.O. box, not the key), so it goes in as `VITE_EXTRACTOR_API_URL`. I'll
> add it to the example file and tell you the exact one line to add as a GitHub
> Secret — same place your Autodesk/Google settings already live.* **(You paste
> that one value in; I give you the exact text.)**

### ☐ Step 10 — Go live and test together
> *You merge to `main` (that auto-deploys, as it does today), then we open Add
> New Tool → Extract, drop in a screenshot of a tool, and watch the fields fill
> in. If Claude reads something wrong, we tune the instructions — that's
> normal fine-tuning, not a bug.*

---

## What this costs

Anthropic charges per use, roughly by the amount of text/image processed. For
occasional tool extraction this is **tiny** — realistically a **fraction of a
cent to a couple cents per tool**. A **$5** starting balance will likely cover a
*very* long time of normal use, and because you pre-load a fixed amount, it can
never surprise you with a bill. Cloudflare's part is **free** at your scale.

## If something goes wrong

- **Extract button gives an error mentioning the key** → the secret in Step 4
  isn't named exactly `ANTHROPIC_API_KEY`, or wasn't saved. Re-check Step 4.
- **Error about "origin" or "blocked"** → the app is being served from an
  address not in the doorman's allow-list. Tell me the address in your
  browser's bar and I'll add it.
- **"insufficient credit" type message** → the Anthropic balance ran out; top it
  up in the console (Step 1).
- **Anything else** → screenshot what you see and send it. Every one of these is
  fixable; none of it can break the rest of the app.

## How this connects to the bigger Phase A plan

The doorman you just built is **Step 4 of Phase A** ("stand up a Worker"), done
early. When you're ready for the full Phase A (private repo + all-day login),
we add the login endpoints to *this same Worker* and move the Autodesk/Google
secrets in next to `ANTHROPIC_API_KEY`. So doing the extractor now is a genuine
head start on Phase A, not a detour.

---

## The doorman code (for copy-pasting in Step 3)

This is identical to `worker/extractor-worker.js` in the repo — paste whichever
is easier. If the code and this printed copy ever disagree, **the file wins**
(I keep it up to date there).

```js
/**
 * ToolDex — Claude extraction relay (Cloudflare Worker)
 * This is the little "doorman" that holds your Anthropic API key.
 * The key is NOT in this file — it lives in Cloudflare's secret store under
 * the name ANTHROPIC_API_KEY (you add it in Step 4). The code reads it privately.
 */

// Which website(s) are allowed to use this relay. Add your local dev address
// here too if you ever run the app on your own machine.
const ALLOWED_ORIGINS = [
  "https://incrementaldan.github.io", // the live app on GitHub Pages
  "http://localhost:5173",            // local development (optional)
];

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 2048;

function corsHeaders(origin) {
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

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST" }, 405, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "Server is missing ANTHROPIC_API_KEY" }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be JSON" }, 400, cors);
    }

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

    const text = await apiRes.text();
    return new Response(text, {
      status: apiRes.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  },
};
```
