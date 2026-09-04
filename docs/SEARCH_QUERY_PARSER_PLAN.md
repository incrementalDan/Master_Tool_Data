# Natural-language search — plan

**Status:** plan only. Nothing built. Phase 0 shipped separately (see below).

**The goal, in the owner's words:** *"I want to be able to search normal things
and have it come up. `.5 EM 3fl`, `1/2 end mill`, `.375 EM with .125 R 4 FL`,
`.125 ball .5 LOC`. Normal language plus filters is the best search. The worst
sites like MSC just take your words and pull all the results with no good way
to refine."*

---

## The one rule this is built on

⚠️ **THE PARSER FILLS THE FILTER CONTROLS. IT NEVER BYPASSES THEM.**

Typing `.375 EM with .125 R 4 FL` sets the **type tile**, the **diameter**, the
**corner radius** and the **flutes** facet — visibly, as the chips that are
already on screen — and the user then adjusts them by hand.

That is the whole difference from MSC. Not a bag of words scored against a
description, but *"here is how I read you — fix it if I am wrong."* Everything
already built (cascading facets, the tolerance, the ≤ = ≥ operator dial,
Clear all) keeps working, because the parser produces the same
`activeFilters` object the UI already edits.

**Corollary — never drop a word.** Any token the parser does not recognise
stays in `textQuery` and is still substring-matched. A query is only ever
*better* understood, never narrowed by something the parser silently ate.

---

## Why NOT the Claude API in the search path

The API connection exists and the ask is cheap, so this is a deliberate no:

- **Search is in-memory and instant by design** — CLAUDE.md: *"All search and
  filtering is client-side and instant."* A round-trip per keystroke ends that.
- **The vocabulary is CLOSED and already in the repo.** `TOOL_TYPES`,
  `TYPE_CODES`, `OP_TYPES`, `LETTER_DRILLS`, `FRACS`, and every abbreviation
  `buildDesc` emits. There is nothing to infer.
- **A parser is test-lockable; an LLM parse is not reproducible.** The same
  query must give the same filters every time, or the chips cannot be trusted.
- **Demo mode, local mode and an offline shop floor** all still have to search.

**Where Claude does earn its place:** generating the **synonym table once,
offline** — every plausible way someone writes "bull nose" — reviewed by a
human and committed as data. A build-time asset, never a runtime call.

---

## The insight that makes this small

**It is `buildDesc` run backwards.** The shop's naming convention already
encodes the grammar; parsing is reading the same convention instead of writing
it. Like a post-processor and a reverse post — you already own the vocabulary.

`buildDesc` (`src/utils/toolNaming.js`) emits, e.g.:

```
${dStr} BULL${crStr} ${fl}FL ${loc3}LOC${tsc}     ->  .375 BULL.125 4FL .5LOC
${dStr} BALL ${fl}FL ${loc3}LOC${tsc}             ->  .125 BALL 3FL .5LOC
${dStr}${caStr} CHAMFER${tsc}                     ->  1/8 (.125) 90DEG CHAMFER
```

**Every number is followed by its label.** `4FL`, `.5LOC`, `90DEG`, `.125R`.
That single observation is the whole grammar.

---

## Grammar

### Token kinds

| Kind | Examples |
|---|---|
| **NUMBER** | `.5`, `0.5`, `1/2`, `3/16`, `6mm`, `.0625` |
| **LABEL** | `LOC`, `R`, `FL`, `OAL`, `REACH`, `DEG`, `KERF` |
| **TYPE** | `EM`, `ENDMILL`, `END MILL`, `BALL`, `BULL`, `CHAMFER`, `DRILL`, `TAP`, `REAMER`, `SPOT`, `FORM`, `LOLLIPOP`, `DOVETAIL` |
| **ATTRIBUTE** | `CARB`, `HSS`, `COB`, `TSC` |
| **NOISE** | `with`, `and`, `x`, `Ø`, `"` |
| **UNKNOWN** | anything else -> stays in `textQuery` |

### The binding rule

> **A number is labelled by the token immediately after it.**
> **An unlabelled number is the diameter.**
> **Only the first unlabelled number is the diameter** — a second one is left
> in `textQuery` rather than guessed at.

⚠️ **A LABEL CAN ALSO COME FIRST, and that is not theoretical.** Measured on the
real library, corner radius is written **both** ways: `.03R` (39 times) and
`R0.125` / `R.12` (8 times). `buildDesc` emits the first form, but people type
the second, and 8 tools would be unreachable by their corner radius under a
suffix-only rule.

So the rule is: **a number binds to an adjacent label on either side, with the
FOLLOWING token preferred** (it is the more common form and the one the
generator emits). A label already consumed by one number cannot claim another.

### Worked from the owner's four examples

| Query | Reads as |
|---|---|
| `.5 EM 3fl` | dia `.5` · type flat end mill · flutes `3` |
| `1/2 end mill` | dia `.5` · type flat end mill |
| `.375 EM with .125 R 4 FL` | dia `.375` · corner radius `.125` · flutes `4` · type (see decision 1) |
| `.125 ball .5 LOC` | dia `.125` · type ball end mill · flute length `.5` |

All four fall out of the one rule. That is the signal the grammar is right.

### Tokenizer detail that matters

**`3fl`, `.093LOC` and `R0.125` are ONE token in real use and must be split.**
Number and label are written glued together far more often than not — that is
how `buildDesc` writes them, and the label lands on either side (`.03R` /
`R0.125`). A tokenizer that splits on whitespace alone fails every example
above.

---

## Output shape

Exactly the object the UI already edits — no new state, no data model change:

```js
{
  toolTypes: ['flat end mill'],           // the type tiles (multi-select)
  facets: {
    diameter:         { value: '.375', op: '=' },   // numeric -> { value, op }
    corner_radius:    { value: '.125', op: '=' },
    number_of_flutes: '4',                          // bare value
  },
  textQuery: '',                          // whatever was not understood
}
```

**Tolerance:** reuse the landing page's existing diameter tolerance (0.002in /
0.05mm), not a new one.

**Units:** a bare number carries no unit. Phase 0 already matches a typed
diameter as **both** inches and mm against each tool's own unit; the parser
inherits that and adds an explicit `6mm` form.

---

## Decisions needed before coding

These are judgement calls, not implementation details. **Each one is a place a
parser starts being confidently wrong.**

**1. Should a corner radius infer the tool TYPE?**
`.375 EM with .125 R 4 FL` describes a bull nose, but the user typed `EM`.
- *Recommendation:* **no inference.** Set the corner-radius facet and widen the
  type to the end-mill family (`flat end mill` + `bull nose end mill`) using the
  multi-select that already exists. Guessing a single type hides results;
  widening cannot.

**2. What does bare `EM` mean?**
`buildDesc` uses `EM` for flat, but also writes `TAPERED EM` and `ROUGH EM`.
- *Recommendation:* `EM` alone -> flat end mill; `EM` + a corner radius -> the
  family, per decision 1.

**3. Auto-apply, or suggest?**
- *Recommendation:* **auto-apply**, because the chips are visible and editable,
  with a one-click *"search these words instead"* escape that dumps everything
  back into plain text.

**4. The link picker has no facet UI.**
`ToolLinkPicker` is a text box and a type dropdown — there are no chips to fill.
- *Recommendation:* apply the parsed filters internally and render a small
  **read-only** "read as" row, so the picker still shows its work. Do NOT build
  a second filter UI there.

**5. Where does the parse live?**
- *Recommendation:* a new pure module `src/utils/searchQuery.js` (framework-free,
  mirroring `toolIdSystem.js` / `locationSystem.js`), called by `LandingPage`
  and `ToolLinkPicker`. **Not** inside `textSearch` — parsing and matching are
  different jobs, and `textSearch` must stay a plain substring filter.

---

## Vocabulary — measured, not invented

Most common words in the real 302-tool library, which is what people actually
type:

```
LOC 139 · FL 115 · DRILL 78 · EM 76 · DEG 53 · BULL 31 · AL 30 · TAP 27
MM 26 · MILL 24 · BALL 24 · FORM 21 · CARB 16 · ENDMILL 16 · HSS 14
FLUTE 14 · CHAMFER 14 · REACH 12 · SPOT 11 · REAMER 9 · KERF 9 · TSC 8
```

⚠️ **`AL` at 30 is a trap.** It is a *material suitability* ("for aluminium"),
not a tool type or a size. It belongs to the `material_suitability` facet, and a
parser that treats every known word as a type will mis-file it.

---

## Testing

**1. The round-trip corpus — the strong one.**
For **every tool in the real library**: take its own generated description,
feed it to the parser, and assert the parsed filters **still find that tool**.
302 self-verifying cases, no fixtures to drift. Mirrors the repo's existing
round-trip audit culture.

**2. A hand-written query corpus.**
A file of real searches -> expected filters. **This is the actual spec** — the
owner's four examples plus ~20 more they'd genuinely type. Worth more than any
grammar I infer.

**3. The never-narrow guard.**
A parsed query must never return **zero** results where the plain text search
returned some. If the parse over-constrains, fall back to text and say so.

---

## Phasing

| Phase | What | Size |
|---|---|---|
| **0 — DONE** | Numeric diameter matching, both units, both searches. Tools unfindable by their own diameter: **262 -> 0**. | small |
| **1** | Tokenizer + binding rule + the type/label/attribute tables. Pure module + tests, no UI. | medium |
| **2** | Wire into `LandingPage` — parse fills the facet chips. | small |
| **3** | Wire into `ToolLinkPicker` with the read-only "read as" row. | small |
| **4** | Synonym expansion (Claude-generated offline, human-reviewed, committed as data). | small |

**Phase 1 is the only real work.** 2 and 3 are wiring, because the filter
object already exists.

---

## Explicitly out of scope

- **Any API call in the search path** (see above).
- **Ranking / relevance scoring.** `sortResults` already floats an exact ID
  match; this changes *what matches*, not *what sorts first*.
- **Saved searches, search history, query autocomplete.**
- **Parsing anything but the tool library** — not holders, parts or programs.
- **Free prose** (`something to cut a slot in stainless`). The grammar covers
  shop shorthand, which is what actually gets typed.

---

## Open risk

**The parser will sometimes be wrong.** The mitigation is structural, not
accuracy: it shows its reading as editable chips, it never eats a word it did
not understand, and it never returns zero where text alone found something.
A wrong parse should cost one click, not a failed search.
