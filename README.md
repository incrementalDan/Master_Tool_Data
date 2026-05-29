# Fusion Tool Library Manager

A web app for managing a CNC cutting tool library. It replaces the fragmented workflow of pulling tools from a master Fusion 360 library, editing per-job, and never syncing back.

The Fusion tool library is read and written **directly to the Fusion 360 cloud** via Autodesk Platform Services (APS). Extra fields Fusion doesn't support live in a `tool_metadata.json` file on Google Drive.

---

## What This App Does

- Single source of truth for all tool data — reads/writes the real Fusion 360 cloud library
- Cascading faceted search across your full library
- Edit tools with all speeds/feeds and metadata inline
- Exports to both Fusion 360 JSON and ProShop CSV formats
- One-time import flow for bootstrapping from existing Fusion/ProShop libraries
- AI-assisted tool extraction from photos, PDFs, or spec sheet text
- Autodesk OAuth login (PKCE) for the Fusion library + optional Google login for metadata

---

## Prerequisites

- An Autodesk account with access to a Fusion hub, and the app provisioned in that hub
- (Optional) A Google account with access to the shared Drive folder, for metadata
- Node.js 18+ and npm

---

## Setting Up APS (Autodesk Platform Services)

1. Go to [aps.autodesk.com](https://aps.autodesk.com/) and sign in with your Autodesk account.
2. Create a new app — select app type **"Single Page App"** (this enables PKCE; no client secret needed).
3. Copy your **Client ID** — you do **not** need the client secret.
4. Add callback URLs (must match `VITE_APS_CALLBACK_URL` exactly, including the trailing slash):
   - `http://localhost:5173/Master_Tool_Data/` (local dev — matches the Vite `base`)
   - `https://yourusername.github.io/Master_Tool_Data/` (GitHub Pages)
5. Add `VITE_APS_CLIENT_ID` and `VITE_APS_CALLBACK_URL` to your `.env`.
6. **Provision the app in your Fusion hub** (done once by a hub admin):
   - Go to your Fusion hub admin page
   - Under **Custom Integrations → Add Custom Integration**
   - Enter your Client ID and a name, then save
   - Team members can now sign in and access the library

---

## Setting Up Google Drive (Metadata — Optional)

The metadata file holds the fields Fusion can't store (tags, notes, ProShop IDs, material suitability, etc.). You can skip this and run Fusion-only, but you'll lose those fields.

1. In the shared Google Drive folder, create one file:
   - `tool_metadata.json` — paste in `[]` as the initial content
2. Get its File ID from the URL: `drive.google.com/file/d/**FILE_ID_HERE**/view`
3. In [console.cloud.google.com](https://console.cloud.google.com):
   - Create/select a project → enable the **Google Drive API**
   - Create an **OAuth client ID** (type: Web application)
   - Authorized JavaScript origins: `http://localhost:5173` and `https://yourusername.github.io`
   - Copy the Client ID and add team members as Test Users on the consent screen
4. Add `VITE_GOOGLE_CLIENT_ID` and `VITE_METADATA_FILE_ID` to your `.env`.

---

## .env Configuration

Copy `.env.example` to `.env` and fill in your values:

```
VITE_APS_CLIENT_ID=your_aps_client_id
VITE_APS_CALLBACK_URL=https://yourusername.github.io/Master_Tool_Data/

VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
VITE_METADATA_FILE_ID=1zYxWvUtSrQpOnMlKjIhGfEdCbA
```

**Never commit `.env` to git.** It is in `.gitignore` already.

---

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173/Master_Tool_Data/](http://localhost:5173/Master_Tool_Data/). Sign in with Autodesk, pick your tool library file, then (optionally) connect Google Drive.

> Note: the dev URL includes `/Master_Tool_Data/` because that's the Vite `base`. Your APS callback URL must match it exactly.

---

## Deploying to GitHub Pages

1. In `vite.config.js`, `base` is set to `/Master_Tool_Data/` — change it if your repo name differs.
2. Deploy:
   ```bash
   npm run deploy
   ```
   This builds and pushes `dist/` to the `gh-pages` branch.
3. In your GitHub repo: **Settings → Pages → Source: `gh-pages` branch, folder `/ (root)`**.
4. Make sure your GitHub Pages URL is registered as a callback URL on your APS app and as an authorized origin on your Google OAuth client.

---

## First-Time Use / Library Setup

1. **Sign in with Autodesk** — redirects to Autodesk, then back to the app.
2. **Select your tool library file** — navigate Hub → Project → folders, then pick the `.json` tool library. This choice is saved in `localStorage` so you only do it once (use "Change library" in the top bar to repick).
3. **Connect Google Drive** (optional) — for metadata fields, or skip.

---

## Adding a New Team Member

1. Ensure the APS app is provisioned in your Fusion hub (one-time, by an admin).
2. (For metadata) share the Google Drive folder with their Google account.
3. They open the app URL, sign in with Autodesk, and select the tool library file.

---

## Initial Data Population (Import Flow)

Navigate to **Import** in the top nav.

**Step 1 — Import Fusion Library**
- Upload a `fusion_tool_library.json` export. The app parses all tools and assigns stable IDs.

**Step 2 — Merge ProShop Library**
- Upload a ProShop CSV export. The app matches rows by Part Number and description.
- Matched fields fill gaps (they never overwrite existing values).
- Choose "Add as New Tool" or "Skip" for unmatched ProShop rows.

**Step 3 — Review & Save**
- Review the merged list, optionally export a clean ProShop CSV / Fusion JSON.
- Click **Save** to write the Fusion library back to the APS cloud (and metadata to Drive).

---

## Architecture

- **Frontend**: React 18 + Vite, hosted on GitHub Pages (HashRouter)
- **Fusion library**: Autodesk Platform Services — Data Management API, PKCE OAuth (`apsService.js`)
- **Metadata**: Google Drive `tool_metadata.json` (`driveService.js`)
- **All search and filtering runs in memory** — the cloud is only called on load and on save
- **No backend server** — fully client-side

The Fusion JSON format is preserved exactly, so Fusion 360 reads the library directly. Our app's tool IDs are stored in Fusion's `guid` field.

### Important constraints

- **Never add extra fields to the Fusion tool library JSON.** Fusion validates strictly and flags tools with unrecognized fields. All extra fields go in `tool_metadata.json` on Drive only.
- **Tokens are in memory only** (`window._apsToken`) — never written to `localStorage`. A page reload requires signing in again.
- **The library is always re-downloaded from APS immediately before a write**, never written from a stale in-memory copy.
- **The saved library location** (`hubId`, `projectId`, `folderId`, `itemId`, `fileName`) is stored in `localStorage` under `aps_library_location` — it's not sensitive.

---

## Data Model

- **Fusion tool library (APS cloud)** — Fusion 360–native format. Geometry, dimensions, speeds/feeds, and everything Fusion can read. The app writes only Fusion-compatible fields here.
- **`tool_metadata.json` (Google Drive)** — Flat array of objects linked by `id` (matches `guid` in the Fusion library). Manufacturer info, ProShop IDs, coatings, material suitability, tags, notes, and other fields Fusion doesn't support.

Both are always read before any write to prevent teammate overwrites.
