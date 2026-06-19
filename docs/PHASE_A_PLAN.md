# Phase A — Private Hosting + Secure All-Day Login

## Context (why we're doing this)

Today the app runs **100% in the browser** (client-side) and is hosted on **GitHub Pages**, which forces the repo to be **public**. Logins also don't survive page refreshes or new tabs well, and Google tokens expire mid-session.

Phase A fixes three things at once **without** touching how your data is stored:

- Make the **repo private** (move off GitHub Pages).
- **Stay logged in all day, across multiple tabs**, no re-login.
- Hold login tokens the **secure way** (in a cookie the browser's JavaScript can't read), by adding a tiny backend.

**Out of scope for Phase A (on purpose):** Google Drive keeps storing everything exactly as it does today. Moving files to R2 (Phase B) and the database/ERP move (Phase C) come later, as separate steps.

> **The big idea in one sentence:** we add a small "doorman" (a backend on Cloudflare) that handles login and holds the keys, so your browser never has to keep a sensitive key lying around — and we move the website itself to a private home.

---

## What changes (before → after)

| | Before | After (Phase A) |
|---|---|---|
| Hosted on | GitHub Pages (public repo forced) | Cloudflare Pages (private repo) |
| Login tokens held | In the browser's memory/storage | In the backend; browser gets a cookie only |
| Stays logged in | Lost on refresh / per-tab | All day, all tabs, auto-refreshes |
| Data storage | Google Drive | Google Drive (unchanged) |
| Cost | Free | Free (Cloudflare commercial tier) |

---

## The plan, in four parts

Each **Step** is the action. The indented note under it is *what it's doing and why* — skim or skip.

### Part 1 — Move the website to a private home (no login changes yet)

This part proves the app still runs from its new home before we touch anything risky.

#### ☐ Step 1 — Create a free Cloudflare account and connect the repo
> *Cloudflare Pages is the new host. Connecting the repo means every time we push code, it auto-builds and deploys — same idea as GitHub Pages does today.* **(You do this; I'll guide.)**

#### ☐ Step 2 — Deploy the app to Cloudflare Pages and confirm it loads
> *At this point it's still the current client-side app, just served from Cloudflare. We confirm the site works from its new address before changing anything else.*

#### ☐ Step 3 — Flip the GitHub repo to private, then retire GitHub Pages
> *Once Cloudflare is serving the site, the public GitHub Pages host is no longer needed, so the repo can go private. This is the moment your source code becomes private.* **(You flip the setting.)**

---

### Part 2 — Build the small backend (the "doorman")

This is the new piece. It's a handful of small backend functions on Cloudflare (called a **Worker**).

#### ☐ Step 4 — Stand up an empty Cloudflare Worker and confirm it responds
> *Just a skeleton with a "hello" endpoint, to prove the backend deploys and the app can talk to it. No real logic yet.* **(I build; you deploy.)**

#### ☐ Step 5 — Move the Autodesk login into the Worker
> *The Worker takes over the Autodesk sign-in: it does the redirect, swaps the login code for tokens, stores the refresh token server-side, and sets a secure cookie. This is what makes login survive all day and across tabs.* **(I build.)**

#### ☐ Step 6 — Move the Google login into the Worker (optional-metadata path)
> *Same treatment for Google so Drive access also stays alive all day. Google stays optional, exactly like today — it just stops expiring mid-session.* **(I build.)**

#### ☐ Step 7 — Put the secret keys into Cloudflare (not the code)
> *The Autodesk and Google secrets live only inside Cloudflare's secret store — never in the repo, never in the browser. This is the main security upgrade.* **(You paste them in; I tell you exactly which ones.)**

---

### Part 3 — Point the app at the backend

#### ☐ Step 8 — Rewire the app's two login files to call the Worker
> *Today the browser talks to Autodesk/Google directly. We change the two files that already handle this (`apsService.js`, `driveService.js`) to talk to our Worker instead. Because login was already isolated in just these two files, the rest of the app is untouched.* **(I build.)**

#### ☐ Step 9 — Re-register the login callback addresses
> *Autodesk and Google each have a setting for "where to send the user back after login." Those now point at the Worker's new address instead of GitHub Pages. Fiddly but quick.* **(You update both, in the Autodesk and Google developer consoles; I give you the exact values.)**

---

### Part 4 — Go live and check it

#### ☐ Step 10 — Test the full round trips, live
> *OAuth can only be truly tested with real sign-ins on the real address, so we'll click through together: sign in with Autodesk, load the library, save a change, open a second tab (should NOT ask to log in), leave it idle, come back (should still be logged in).*

#### ☐ Step 11 — Confirm Google save works and tokens never appear in the browser
> *Save a note/tag (Drive write), and verify in the browser's dev tools that no refresh token is sitting in storage. That's the proof the secure model is working.*

---

## Who does what

- **I do:** all the code (the Worker, rewiring the two login files), and I write down every exact value you need.
- **You do:** the click-through setup that only an account owner can — create the Cloudflare account, paste secrets, update the two callback addresses, flip the repo private, and drive the live sign-in tests with me.

> *This split is why I flagged it earlier: the typing is small, but OAuth setup touches accounts only you control and needs live sign-ins to test. Expect some back-and-forth, not a silent one-shot.*

## Rough effort

A focused **day or two** of build, plus the live-testing back-and-forth. No recurring cost at your scale.

## What this sets up for later (not now)

- **Phase B:** move tool photos/files from Google Drive → Cloudflare R2 (object storage).
- **Phase C (ERP):** move the structured JSON (`tool_metadata.json`, `materials.json`, etc.) into a real database (Cloudflare D1). Your existing "link by ID" model maps naturally onto database tables.
