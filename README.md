# ToolDex

**The shop's single source of truth for cutting tool knowledge.**

When a machinist proves that a specific end mill, in a specific holder, at a specific stick-out, at specific speeds and feeds, works — that knowledge used to live in someone's head, or get lost the next time the job ran. ToolDex captures it.

Every tool in the library carries not just geometry, but the *proven setup*: which holder, how far it sticks out, what speeds and feeds were actually run, and which material it was proven on. When a programmer needs to cut a new job, they pull from real, shop-verified data — not guesses.

---

## What It Solves

Before: tools lived in a shared Fusion 360 library. Programmers copied them into job files, tweaked speeds and feeds, got good results — and those results stayed in the job file forever. The master library stayed stale. Knowledge was tribal and tied to individuals.

After: ToolDex is the master. Proven job values sync back through a structured compare-and-merge workflow. The shop accumulates knowledge instead of re-learning it.

---

## What It Does

- **Captures proven setups** — each tool tracks its assemblies (holder + stick-out combinations) and the speeds, feeds, and cutting conditions proven in real jobs
- **Eliminates tribal knowledge** — every setup is documented, searchable, and shared across the team
- **Connects to CAM** — reads and writes the Fusion 360 cloud tool library directly via Autodesk Platform Services (APS); proven job values can be synced back to master through a side-by-side diff and merge flow
- **Connects to ERP** — imports from and exports to ProShop CSV; ProShop remains authoritative for inventory and purchasing
- **Material taxonomy** — a 3-tier material library (ISO groups → CAM presets → individual alloys) links proven speeds/feeds to the exact material they were run on
- **Vendor and purchasing data** — normalized manufacturer/vendor records with catalog numbers, pricing, and URL links
- **Cascading faceted search** — instant in-memory search across the full library by type, diameter, flutes, material, coating, machine, tags, and more
- **AI-assisted extraction** — extract tool specs from photos, PDFs, or spec sheet text to add new tools quickly
- **Local browse mode** — upload a Fusion library JSON and browse it without any cloud login

---

## Architecture

```
Autodesk cloud (BIM 360 / ACC)
├── fusion_tool_library.json     ← Fusion 360 reads this; app reads/writes via APS
└── holder_library.json          ← Toolholder library; read-only

Google Drive (shared team folder)
├── tool_metadata.json           ← Proven setups, assemblies, notes, tags, purchasing
├── materials.json               ← Material taxonomy: groups → CAM presets → alloys
├── vendor_registry.json         ← Manufacturer and vendor entity list
└── shop_settings.json           ← Shop-wide settings

Web App (GitHub Pages, client-side only)
├── APS PKCE OAuth (required — gates library access)
├── Google OAuth (optional — only needed for metadata and Drive files)
├── Everything loads into memory on login; search and filter are instant
└── Writes changes back to APS and Drive on save
```

**No backend server.** Fully client-side. Hosted on GitHub Pages.

---

## Tech Stack

- React + Vite — hosted on GitHub Pages (HashRouter)
- Autodesk Platform Services — Data Management API, PKCE OAuth
- Google Drive API v3 — metadata, materials, vendor registry, tool file attachments
- `lucide-react` for UI icons

---

## Prerequisites

- An Autodesk account with access to a Fusion hub, and the app provisioned in that hub
- Node.js 18+ and npm
- (Optional) A Google account with access to the shared Drive folder, for metadata

---

## Environment Variables

Copy `.env.example` to `.env`:

```
VITE_APS_CLIENT_ID=           # APS app Client ID (Single Page App type)
VITE_APS_CALLBACK_URL=        # Must match your APS callback URL exactly, including trailing slash
VITE_GOOGLE_CLIENT_ID=        # Google OAuth Client ID (optional)
VITE_METADATA_FILE_ID=        # Google Drive file ID for tool_metadata.json (optional)
```

**Never commit `.env`.** It is in `.gitignore` already.

---

## APS Setup (Autodesk Platform Services)

1. Go to [aps.autodesk.com](https://aps.autodesk.com/) and sign in.
2. Create a new app — select **"Single Page App"** (PKCE; no client secret needed).
3. Copy your **Client ID** — no secret required.
4. Add callback URLs (must match `VITE_APS_CALLBACK_URL` exactly, including trailing slash):
   - `http://localhost:5173/Master_Tool_Data/` — local dev
   - `https://yourusername.github.io/Master_Tool_Data/` — GitHub Pages
5. **Provision the app in your Fusion hub** (one-time, by a hub admin):
   - Fusion hub admin page → **Custom Integrations → Add Custom Integration**
   - Enter your Client ID, save
   - All team members can now sign in

---

## Google Drive Setup (Optional)

Metadata, materials, vendor registry, and tool file attachments (photos, spec sheets) all live in a shared Drive folder. You can run Fusion-only without Google, but you'll lose those fields.

1. Create `tool_metadata.json` in your shared Drive folder (initial content: `[]`).
2. Get its File ID from the URL: `drive.google.com/file/d/FILE_ID_HERE/view`
3. In [console.cloud.google.com](https://console.cloud.google.com):
   - Enable the **Google Drive API**
   - Create an **OAuth client ID** (type: Web application)
   - Authorized JavaScript origins: `http://localhost:5173` and `https://yourusername.github.io`
4. Add `VITE_GOOGLE_CLIENT_ID` and `VITE_METADATA_FILE_ID` to `.env`.

> The app uses the `drive` OAuth scope (not `drive.file`) — required to browse shared drives and team folders.

---

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173/Master_Tool_Data/](http://localhost:5173/Master_Tool_Data/). Sign in with Autodesk, select your tool library file, then (optionally) connect Google Drive.

---

## Deployment

Deployment is **fully automated via GitHub Actions**. Push to `main` and the site builds and publishes to GitHub Pages automatically. API keys are injected from GitHub Actions Secrets at build time — they are never in the repo.

**Do not run `npm run deploy` from a CI or cloud session.** That command reads from a local `.env` which doesn't exist in those environments and will publish a broken build.

To deploy manually from a local machine with a valid `.env`: `npm run deploy` (builds and pushes to `gh-pages` branch — only as a fallback).

---

## First-Time Setup

1. **Sign in with Autodesk** — redirects to Autodesk, then back to the app.
2. **Select your tool library file** — navigate your hub and pick the `.json` Fusion tool library. Saved in `localStorage` so you only do this once.
3. **Select your holder library file** — same flow; the holder library is read-only.
4. **Connect Google Drive** (optional) — for metadata, materials, vendor data, and file attachments.
5. **Import existing data** (one-time) — Settings → Import to load from an existing Fusion JSON export or ProShop CSV.

---

## Adding a Team Member

1. Ensure the APS app is provisioned in your Fusion hub (admin one-time step).
2. Share the Google Drive metadata folder with their Google account.
3. They open the app URL, sign in with Autodesk, and select the tool library — done.

---

## Syncing Proven Job Values Back to Master (Phase 2)

This is the core knowledge-capture loop:

1. Programmer proves better speeds/feeds in a Fusion job file.
2. In Fusion: right-click the tool(s) → Copy. Fusion puts them on the clipboard as TSV.
3. In ToolDex: **Sync Job** → paste (Ctrl+V anywhere on the screen).
4. The app auto-matches each tool to master by ProShop ID, GUID, or fuzzy geometry.
5. Side-by-side diff per tool — select which fields to commit, enter a revision note.
6. The app re-fetches master from APS immediately before each write, so concurrent edits are caught.
7. Summary screen — optionally copy all committed tools back to clipboard to paste into Fusion.

Merge history is appended to each tool's record so you can see what changed, when, and why.

---

## Key Constraints

- **Tokens in memory only** — `window._apsToken` never written to `localStorage`. A page reload requires re-authentication.
- **Always re-download before write** — the app fetches the live Fusion library from APS immediately before every save, preventing overwrites from concurrent edits.
- **No extra fields in the Fusion JSON** — Fusion validates strictly. All extra fields (metadata, assemblies, purchasing, tags) live in `tool_metadata.json` on Drive only.
- **HashRouter** — required for GitHub Pages; do not switch to BrowserRouter.
- **ProShop export is permanent** — the ProShop CSV export must never be removed. ProShop remains the inventory and purchasing system of record.
