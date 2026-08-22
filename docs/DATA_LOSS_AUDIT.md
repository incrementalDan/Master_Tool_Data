# Data Loss & Recovery Audit

**Date:** 2026-08-20 · **Status:** findings only — nothing fixed yet · **Storage:** Google **Workspace** account

Read the write paths, not the docs. The risk lives in error handling — what happens on a
404, an empty file, a failed read — and only the code shows that.

## The one-line answer

The data is **not fragile in the "one glitch and it's gone" sense**. It **is** fragile in the
**"a bad update quietly corrupts something and nobody notices for two weeks"** sense.

The reason: there are **no backups**. There is *version history*, which is a different thing
and is capped.

-----

## What protects each file today

### Fusion tool library + holder library (Autodesk / ACC) — well protected

`saveToolLibrary` (`src/services/apsService.js:220`) does not overwrite the file. It uploads
new bytes to a fresh storage object and then **creates a new item version** pointing at it
(step 5). ACC keeps the full version chain and any prior version is restorable from the web
UI. This half is genuinely fine — leave it alone.

### The 7 Google Drive JSON files — this is where the risk is

Every save is a straight content replace:
`PATCH .../upload/drive/v3/files/{id}?uploadType=media` — `driveService.js:121` (`driveUpdate`,
the metadata file) and `driveService.js:245` (`saveSharedJson`, the other six).

Drive does record each write as a revision, **but for uploaded (non-Google-native) files Drive
auto-prunes old revisions after roughly 30 days or 100 versions, whichever comes first**,
unless pinned with `keepRevisionForever`. **The app never sets that flag.**

⚠️ **The sting:** this app writes constantly — every settings edit, every holder autosave,
every tool save is a revision. 100 revisions is plausibly *days* of active work, not a month.
The effective undo window is much shorter than it looks.

And nearly all the value created in this app lives in these files. Fusion holds geometry;
**Drive holds the thinking** — metadata, holders, materials, parts, program details, shop
settings.

The eight files that matter:

| File | Where | Protection today |
|---|---|---|
| `fusion_tool_library.json` | APS / ACC | ✅ full version history |
| `holder_library.json` (Fusion copy) | APS / ACC | ✅ full version history |
| `tool_metadata.json` | Drive | ⚠️ capped revisions |
| `holder_library.json` (app-owned) | Drive | ⚠️ capped revisions |
| `materials.json` | Drive | ⚠️ capped revisions |
| `vendor_registry.json` | Drive | ⚠️ capped revisions |
| `shop_settings.json` | Drive | ⚠️ capped revisions |
| `parts.json` | Drive | ⚠️ capped revisions |
| `tool_components.json` | Drive | ⚠️ capped revisions |
| `program_details.json` | Drive | ⚠️ capped revisions |
| `ProgramFiles/{O####}/` raw CSVs | Drive | ⚠️ capped revisions (renamed, not rewritten — lower risk) |

-----

## The specific holes, ranked by damage

These are real code paths, not hypotheticals.

### 1. ⚠️ A failed load can overwrite a good file with the blank seed — WORST

`sharedSafe` (`src/context/AppContext.jsx:1107`):

```js
const sharedSafe = (key, def) =>
  driveService.loadOrCreateSharedJson(SHARED_FILES[key].name, SHARED_FILES[key].cacheKey, def)
    .catch(e => { if (e.code === 'TOKEN_EXPIRED') throw e; return def; });
```

Any load error that isn't a token expiry substitutes the **default seed** —
`DEFAULT_SHOP_SETTINGS`, `DEFAULT_MATERIALS`, `DEFAULT_HOLDER_LIBRARY`, etc. React state
becomes the seed. Then the next edit fires the debounced write (`scheduleSharedWrite`,
600ms) and **saves that empty seed straight over the real file**.

`driveGet` throws on any non-OK status (`driveService.js:72`), so a network blip, a 5xx, a
permissions change, or non-JSON content is enough to trigger it.

**What's behind this hole:** all three ID systems, every location system, machines,
materials taxonomy, vendor registry, parts, the whole app-owned holder library.

**Note:** `tool_metadata.json` is **not** in this group. It loads via `toolStore.loadAll()`
outside `sharedSafe`, so a load failure throws and aborts the whole load rather than
substituting. That one is correctly built — the other six are not. The fix is to make the
six behave like the one.

### 2. A missing file silently forks to a new empty one

Two places respond to a 404 by creating a fresh file and re-caching the new ID:

- `driveUpdate` (`driveService.js:135`) — `localStorage.removeItem(CACHED_FILE_ID_KEY); return driveCreate(content);`
- `loadOrCreateSharedJson` (`driveService.js:237`) — falls through to `createSharedJson`

So if a file is trashed or moved out of reach, the app doesn't stop — it quietly starts over
with an empty one, and the real data is now unreferenced.

**This explains the orphaned dev files.** Deleting a folder in Drive trashes its children; a
file whose parent is gone becomes *orphaned* — findable in Search and Recent, but with no
folder to navigate into. That is Drive behaving as designed, not an app bug. See
**Recovering orphaned files** below.

### 3. A zero-byte file reads as "no data"

`driveGet` returns `null` on empty content (`driveService.js:78`), and `loadMetadata` turns
that into `[]` (`:161`). An interrupted `keepalive` PATCH on tab close is the plausible way
to produce a zero-byte file. Narrow, but it is a silent-empty path.

### 4. No cross-device conflict guard

`toolStore.upsertMany` re-reads and merges by id — genuinely good, and it covers the common
case (the G1 invariant). But `saveSharedJson` is a **blind overwrite**: two devices editing
settings, last write wins, no warning. Already logged as a TODO in `CLAUDE.md` and
`DECOUPLING_FOLLOWUP_FINDINGS.md` #4.

### 5. There is no backup or export of the metadata set at all

Grepped for it — nothing. The only bulk exports are the Fusion library JSON (geometry only,
`fusionExport.js:87`) and ProShop CSV. **Nothing produces a restorable copy of the eight
files that *are* the app.**

-----

## Recovery today, honestly

| Scenario | Outcome |
|---|---|
| Fusion library corrupted | **Easy.** Restore a prior version in ACC. |
| Drive file wiped, noticed same day | **Doable.** Drive → file → Version history → download old revision → re-upload as a new version. Fiddly, one file at a time. |
| Drive file corrupted, noticed in 2 weeks | **Likely gone.** Past the revision window, no other copy. |
| Bad deploy writes garbage across many tools | **Very bad.** No snapshot to roll back to, and the corruption is inside the current revision chain. |

### Google Workspace changes the picture — for deletion only

Confirmed Workspace, which adds real recovery paths **for deleted files**:

- **Trash** holds deleted files ~30 days, self-service restore.
- **Admin console** can restore a user's permanently-deleted files for **~25 days after**
  they leave the trash (Admin → Users → ⋮ → Restore data). This is the safety net a personal
  account does not have.
- **Google Vault** (if licensed) can set retention rules on Drive and hold/export content
  well beyond that. Worth checking whether the license includes it.
- **Shared drives** protect against the single-owner failure mode (files owned by the drive,
  not a person). Worth confirming the shop folder lives on a shared drive, not in someone's
  My Drive.

⚠️ **None of this helps with the actual threat.** Admin restore and Vault recover *deleted*
files. Every hole above produces a file that still exists with the **wrong contents inside
it** — which reads to Google as an ordinary edit, not a deletion. Workspace makes the
orphaned-dev-files problem recoverable; it does nothing for a bad update.

### Recovering orphaned files (the dev files that show in search but won't navigate)

1. In Drive search: `is:unorganized owner:me` — lists files with no reachable parent.
2. Select them → **Organize / Move to** a real folder to make them navigable again.
3. If they were trashed with their parent folder: restore the **folder** from Trash and the
   children come back with it.
4. If the trash was emptied: Admin console → Users → the account → ⋮ → **Restore data**,
   within ~25 days.

-----

## The plan (next week)

Cheapest first. Items 1–5 remove every sharp edge above for a few days of work.

### Do now

1. **Set `keepRevisionForever: true` on the shared-file writes.**
   One flag on the PATCH in `driveUpdate` and `saveSharedJson`. Stops Drive pruning history.
   Caveat: pinned revisions count against storage and Drive caps them around 200/file — so
   this is a floor, not a plan. **Tiny.**

2. **⭐ Refuse to write a file that failed to load. — HIGHEST VALUE**
   Distinguish *"doesn't exist yet → seed it"* from *"load failed → we don't know what's in
   there"*. On failure, mark the file unloaded, **block writes to it**, show a banner. Same
   *informed, not blocked* pattern already used everywhere else in this app.
   Touches: `sharedSafe` (`AppContext.jsx:1107`), `scheduleSharedWrite`, a new
   `unloadedSharedFiles` state + banner. **Small.**

3. **Stop forking on 404.** Extend the existing `MetadataFileBanner` /
   `metadataFileWarning` behavior to all seven shared files instead of silently creating a
   replacement. `driveUpdate:135`, `loadOrCreateSharedJson:237`. **Small.**

4. **Daily snapshot folder.** Copy all 8 files into `Backups/YYYY-MM-DD/`. Drive's
   `files.copy` is server-side and free (`listFolderChildren`/`copyDriveFile` already exist
   in `driveService.js` for the ProShop photo import). Keep 30 daily + 12 monthly.
   **This is what turns recovery from archaeology into "copy a folder back."**
   **Small-medium.**

5. **Settings → "Download everything" / "Restore from backup."** One zip of all 8 files, so
   there is a copy somewhere that isn't Google. **Small.**

### Do before the next risky bulk action

6. **A write tripwire.** Refuse to save when the record count drops sharply without a
   matching delete — *"about to write 3 records over 268, confirm?"* This is the one that
   catches a **bad update**, which is the actual stated fear. Preview→commit already
   protects the bulk actions well; this protects the ordinary paths. Belongs in the
   `toolStore` seam. **Medium.**

7. **Auto-snapshot before every bulk action** (renumber, normalize, relink, bulk import,
   push holders). Cheap once #4 exists. **Small.**

### Also worth doing (already logged elsewhere)

8. **Multi-device conflict guard** — stamp the metadata file's Drive `modifiedTime` /
   `headRevisionId` at load; on save, if it moved, **block and say why** rather than
   clobber. `DECOUPLING_FOLLOWUP_FINDINGS.md` #4. Implement in the `toolStore` seam.
   **Medium.**

-----

## Does Cloudflare solve anything?

**Yes — but not the thing it would be bought for, and not this month.**

### What it genuinely fixes

- **Writes become atomic and transactional.** Today every save is *"read a whole JSON file,
  change it in memory, write the whole file back."* That read-modify-write cycle is the root
  cause of holes 1–4 — every one of them is a variant of *"the whole file got replaced with
  the wrong contents."* A database write touches one row and either commits or doesn't. That
  removes the entire class of bug **structurally**, instead of by bolting on guards. This is
  the real argument, and it is a strong one.
- **D1 has Time Travel** — automatic point-in-time restore to any minute within the last 30
  days, no configuration. Meaningfully better than Drive revisions.
- **Multi-device conflicts stop being a design problem** and become an ordinary transaction.
- **It was already planned.** D1 *is* SQLite. The UUID discipline and the FK inventory in
  `CLAUDE.md` → **Relational integrity** were built for exactly this migration; that
  groundwork pays off directly.

### What it does not fix, and what it costs

- **Fusion is untouched.** The ACC library still gets whole-file replaced. That half is
  unchanged.
- **A backend appears.** A Worker that authenticates the shop and holds the DB, plus an auth
  story to replace *"Autodesk login gates everything"*. Right now there is no server to
  maintain; there would be. (A `worker/extractor-worker.js` already exists, so the pattern
  isn't foreign.)
- **Drive readability goes away.** Opening `tool_metadata.json` in Drive and reading it has
  been useful for debugging. That stops.

### Verdict

**Cloudflare is the destination, not the fix.** Items 1–5 buy nearly all the safety for a
fraction of the effort and none of the architectural commitment. Do those, then migrate to
D1 deliberately when the SQLite work is due anyway — not in a hurry out of fright.

-----

## The thing that matters most

The single most alarming fact isn't any one bug:

> **`main` → auto-deploy → live shop data, with no snapshot in between.**

Item 4 fixes that for about a day's work.

-----

## Manual backup (until item 4 ships)

Do this **now**, and again before any bulk action or risky deploy.

1. Open the Drive folder holding `tool_metadata.json`.
2. Select all 8 JSON files (`tool_metadata`, `holder_library`, `materials`,
   `vendor_registry`, `shop_settings`, `parts`, `tool_components`, `program_details`) —
   plus the `ProgramFiles/` folder if the posted CSVs matter.
3. **Download** (Drive zips them) → keep the zip somewhere that is **not** Google Drive.
   Name it by date: `tooldex-backup-YYYY-MM-DD.zip`.
4. Separately: in ACC, note the current **version number** of `fusion_tool_library.json` and
   `holder_library.json` — that's the restore point on the Autodesk side.

To restore one file later: Drive → right-click the file → **Manage versions** → *Upload new
version* → pick the copy from the zip. The file ID stays the same, so the app keeps
pointing at it and nothing needs relinking. **Do not delete and re-upload** — that mints a
new file ID and the app will 404 and fork (hole #2).

-----

## Note — `npm run build` proves nothing from a cloud session

There is **no `.env`** in the Claude Code cloud sandbox (correctly — the real
keys live in GitHub Actions Secrets). Without `VITE_APS_CLIENT_ID`, `App.jsx`
short-circuits at module level to the `ConfigError` screen, so the entire real
application is unreachable and the bundler correctly strips it. The build exits
0 and emits ~178 kB of React and dependencies plus a "Configuration Required"
page.

Everything about that is working as designed — it is the same guard `CLAUDE.md`
describes under Deployment ("it will publish a credential-less build and break
the live site"). **It is not a build bug.**

The only practical consequence: **from a cloud session, "the build passed" says
nothing about whether the app compiles correctly.** Use `npm run lint` and the
test suite as the real checks, and let the GitHub Actions run — which injects the
secrets — be the first real build of anything written here.
