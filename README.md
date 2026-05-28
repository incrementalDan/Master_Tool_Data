# Fusion Tool Library Manager

A web app for managing a CNC cutting tool library. It replaces the fragmented workflow of pulling tools from a master Fusion 360 library, editing per-job, and never syncing back. Tools are stored in JSON files on a shared Google Drive folder that Fusion 360 can also read directly.

---

## What This App Does

- Single source of truth for all tool data
- Cascading faceted search across your full library
- Edit tools with all speeds/feeds and metadata inline
- Exports to both Fusion 360 JSON and ProShop CSV formats
- One-time import flow for bootstrapping from existing Fusion/ProShop libraries
- AI-assisted tool extraction from photos, PDFs, or spec sheet text
- Google OAuth login — only accounts with shared Drive folder access can sign in

---

## Prerequisites

- A Google account that has been granted access to the shared Drive folder
- Node.js 18+ and npm
- A Google Cloud project (for OAuth — see setup below)

---

## First-Time Drive Setup

1. In the shared Google Drive folder, create two new text files:
   - `fusion_tool_library.json` — paste in `{"data":[]}` as the initial content
   - `tool_metadata.json` — paste in `[]` as the initial content

2. Get the File IDs for each:
   - Open the file in Drive
   - The ID is in the URL: `drive.google.com/file/d/**FILE_ID_HERE**/view`
   - Copy the long alphanumeric string between `/d/` and `/view`

---

## Google Cloud / OAuth Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Google Drive API**: APIs & Services → Library → search "Drive API" → Enable
4. Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized JavaScript origins:
     - `http://localhost:5173` (for local dev)
     - `https://YOUR_GITHUB_USERNAME.github.io` (for GitHub Pages)
   - Authorized redirect URIs: (leave blank — this app uses implicit flow)
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`)
6. Configure the OAuth consent screen:
   - Add your team's Google accounts as Test Users (while in testing mode)
   - Or publish the app for your Google Workspace domain

---

## .env Configuration

Copy `.env.example` to `.env` and fill in your values:

```
VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
VITE_FUSION_LIBRARY_FILE_ID=1aBcDeFgHiJkLmNoPqRsTuVwXyZ
VITE_METADATA_FILE_ID=1zYxWvUtSrQpOnMlKjIhGfEdCbA
```

**Never commit `.env` to git.** It is in `.gitignore` already.

---

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — you should see the login screen.

Sign in with a Google account that has access to the shared Drive folder.

---

## Deploying to GitHub Pages

1. In `vite.config.js`, set `base` to your repo name:
   ```js
   base: '/your-repo-name/',
   ```

2. Add a `homepage` to `package.json`:
   ```json
   "homepage": "https://your-username.github.io/your-repo-name"
   ```

3. Deploy:
   ```bash
   npm run deploy
   ```

   This builds the app and pushes the `dist/` folder to the `gh-pages` branch.

4. In your GitHub repo settings → Pages, set the source to the `gh-pages` branch.

5. Add `https://your-username.github.io` to your OAuth client's authorized origins in Google Cloud Console.

---

## Adding a New Team Member

1. Share the Google Drive folder with their Google account
2. Have them go to the app URL and click "Sign in with Google"
3. They'll have full access immediately — no other setup needed

---

## Initial Data Population (Import Flow)

Navigate to **Import** (gear icon in the top nav) after signing in.

**Step 1 — Import Fusion Library**
- Export your current library from Fusion 360 as a JSON file
- Upload it in the Import flow
- The app parses all tools and assigns stable IDs

**Step 2 — Merge ProShop Library**
- Export your tool list from ProShop as a CSV
- The app matches rows to Fusion tools by Part Number and description
- Matched fields fill gaps (they never overwrite existing values)
- Choose to "Add as New Tool" or "Skip" for any unmatched ProShop rows

**Step 3 — Review & Save**
- Review the merged tool list
- Optionally export a clean ProShop CSV and Fusion JSON
- Click "Save to Drive" to write everything back and set the library as your new source of truth

---

## Architecture

- **Frontend**: React 18 + Vite, hosted on GitHub Pages
- **Auth**: Google OAuth (implicit flow via `@react-oauth/google`)
- **Storage**: Two JSON files on Google Drive (`fusion_tool_library.json` + `tool_metadata.json`)
- **All search and filtering runs in memory** — Drive is only called on initial load and on save
- **No backend server** — fully client-side

The Fusion JSON format is preserved exactly, so Fusion 360 can continue reading the library file directly. Our app's tool IDs are stored in Fusion's `guid` field.

---

## Data Model

Two Drive files that stay in sync:

- **`fusion_tool_library.json`** — Fusion 360–native format. Contains geometry, dimensions, speeds/feeds, and everything Fusion can read. The app writes only Fusion-compatible fields here.
- **`tool_metadata.json`** — Flat array of objects linked by `id` (matches `guid` in the Fusion file). Contains manufacturer info, ProShop IDs, coatings, material suitability, tags, notes, and other fields Fusion doesn't support.

Both files are always read before any write to prevent teammate overwrites.
