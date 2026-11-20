# Keeping LightCast in step with DeckCraft

LightCast's editor follows [DeckCraft](https://github.com/storytold/deckcraft) (a Rust PowerPoint
clone, MIT / Apache-2.0). Its commands live in `crates/engine/src/cmd/**/*.rs`; the engine inside
LightCast (`engine/`) is built from DeckCraft's crates plus `engine/freecast-engine`.

Last DeckCraft commit LightCast has been compared against and brought up to date with:

```
DECKCRAFT_SYNCED=5b422e8dc5fb24558f90175475d68cdc03a29e19
```

(`rtf: delegate outline RTF heading/body emission to craft-rtf (refs storytold/craft-libs#778) (#2269)`.)

## The routine (run by a scheduled Claude session; also fine to run by hand)

1. Clone or update DeckCraft (`git clone https://github.com/storytold/deckcraft` into a scratch
   folder, or `git pull` there). Read `DECKCRAFT_SYNCED` above.
2. `git log --oneline $DECKCRAFT_SYNCED..origin/main` in DeckCraft. If it is empty: stop, do nothing,
   do not open a PR.
3. Read each new commit's diff (`git show`, limited to `crates/` and the app UI). Classify the change:
   - **Behaviour or feature in an area LightCast has** (text, shapes, pictures, tables, SmartArt,
     animations, transitions, review, view, master, find, clipboard…): port it. Engine logic goes
     into `engine/freecast-engine` (or the vendored DeckCraft crates under `engine/`) and the app
     side into `src/`; run `cd engine && cargo test` and `npm run engine` when Rust changed.
   - **A new DeckCraft feature LightCast lacks:** add it, with Korean UI labels matching PowerPoint's
     Korean UI, the app's green/yellow look, and tests.
   - **Not applicable** (16:9 slide sizes — slides stay 4:3; desktop file dialogs; automation-only
     queries) or **removed on purpose** (accessibility checker; stage / worship-team / preacher
     screens; 예배 전 준비·점검, 안전 모드, 대기 컴퓨터; the six moving background presets): skip it.
4. Update `DECKCRAFT_SYNCED` in this file to DeckCraft's current `origin/main` commit, and add a line
   per ported commit to the list below.
5. Release as in `CLAUDE.md`: `npx tsc --noEmit -p .` and `npx vitest run` must pass; bump the
   version (odometer rule), commit, push, open a PR, merge it once its checks pass, and check that the
   release has the universal Mac `.dmg`, the Windows `.exe` and the update files.
6. If a change is too large or unclear to port safely in one run, port what is safe, leave
   `DECKCRAFT_SYNCED` at the last fully handled commit, and say what is left in the PR description.

## Ported so far

- Everything up to `6eebec7` (see README, "더 많은 DeckCraft 기능").
- `6eebec7..9b1fe3f` (10 commits, 2026-11-12): nothing to port. They fix DeckCraft's own PPTX reader, writer and
  renderer (chart legend entries `c:legendEntry`, a picture in a placeholder showing the layout fill, custom
  geometry guide lists). Since then LightCast's own PPTX reader (`src/domain/io/pptxDeck.ts`) does read charts
  (`pptxChart.ts`, cached values into an editable chart), placeholder inheritance from layout and master, and
  `custGeom` with literal coordinates (guide formulas are still drawn as a rectangle and reported): compare
  DeckCraft's PPTX reader changes against those files on the next sync.
- `9b1fe3f..ef9ac9a` (60 commits, 2026-11-13):
  - Ported: `edit.duplicate` keeps a member of a group in its group (`duplicateSelection`; the copy goes after the
    group's last member; a group duplicated whole still gets a new group); `shape.merge` on group members (LightCast
    keeps flat coordinates, so no refusal is needed, but the merge no longer leaves a one-member group behind);
    forward Delete removes a whole grapheme cluster (the browser's own Delete in the editors and `charMove` /
    `deleteWord` already step by cluster; tests added).
  - Not applicable: `arrange.ungroup` of a nested group (LightCast groups are one level, `groupId`), a shape copied
    from a group pastes where it was drawn (members carry slide coordinates, no group transform), PPTX reader fixes
    (paragraph-build inference, master text styles, picture backing, large adjustment guides, series `c:dLbls`,
    slide-list limits and unresolved relationships), automation roots, About window, CI.
  - WMF / EMF / EMF+ reading (`craft-metafile`, a new external crate replacing `crates/metafile`) was ported later, in
    TypeScript: see "Windows metafiles" below. No Rust changed, so the wasm was not rebuilt.
- `ef9ac9a..69379cf` (2 commits, 2026-11-14): nothing to port. `7a24b20c` only documents DeckCraft's PPTX
  slide-list import limit; `69379cf6` renames DeckCraft's own feature labels in English ("Diagram", "Decorative
  Text"), while LightCast uses PowerPoint's Korean names (SmartArt, WordArt). The Rust renames are display strings
  only; the wasm was not rebuilt.

## Windows metafiles (WMF, EMF, EMF+): handled in TypeScript, not by the engine

DeckCraft reads `.wmf`, `.emf` and EMF+ inside `.emf` with the external `craft-metafile` crate
(`storytold/craft-libs`, pinned in DeckCraft's `Cargo.toml`; before `ac3e46b` it was `crates/metafile` in DeckCraft
itself, which is where this port was read from). LightCast does **not** link that crate and the engine wasm was not
rebuilt for it: `src/domain/metafile/` is a self-contained TypeScript reader that draws a metafile as an SVG
(`metafileToSvg`) and, with a DOM, as a PNG (`metafileToBlob`, `pictureBlob` in `image.ts`).

- Used by: PPTX import (`io/pptxRender.ts`, `io/pptxImport.ts`), pasted PowerPoint objects (`io/drawingml.ts`
  `readGvml`), 삽입 › 그림 and every other picture chooser (accept `.wmf,.emf`), drag-and-drop and paste of
  `.wmf` / `.emf` files (`ui/importFiles.ts`, `ui/ppt/pasteObjects.ts`), and `putMedia` (`domain/media.ts`), which
  draws any metafile it is handed into an ordinary image before it is stored.
- When `craft-metafile` changes (check `git log -- Cargo.toml Cargo.lock` and commits mentioning "metafile"): port the
  change into `src/domain/metafile/` and add a test to `tests/metafile.test.ts` or `tests/metafileReal.test.ts` (real files
  in `tests/fixtures/real/metafile/`, see its README; the gaps closed later are in `tests/metafileGaps.test.ts`).
  Flood fills go through a small software rasteriser (`raster.ts`), EMF+ path gradients and blends through
  `gradient.ts`, image effects through `effects.ts` (SVG filters), glyph-index text and text widths through the
  font files registered in `fonts.ts` (imported fonts and fonts from decks). Still not drawn (see the header of
  `src/domain/metafile/index.ts`): ImageAttributes colour matrices / remap tables (EMF+ cannot store them),
  red-eye correction of PNG / JPEG images, glyph indices in WMF text.
- DeckCraft plays the GDI records of an EMF+ "dual" file; LightCast prefers the EMF+ records and uses the GDI
  fallback only when EMF+ draws nothing, or between an EMF+ `GetDC` and the next EMF+ record.
- `69379cf..5c69849` (38 commits, 2026-11-14 to 2026-11-16):
  - Ported: the 3- and 4-bend elbow and curved connectors (`bentConnector4/5`, `curvedConnector2/4/5`) follow
    presetShapeDefinitions, with `adjust_defaults()` giving the spec's 50000 to presets outside the gallery (the
    reader's guides are read by name, so a file giving only `adj2` no longer loses the others: `presetAdjust` in
    `drawingml.ts`); a slide show that advances to a slide starts it over so its animations play again
    (`ShowState::enter_forward`, patch applied to the vendored `anim` crate); `arrange.align` / `arrange.distribute`
    refuse an `edge`, `dir` or `to` they do not name (`freecast-engine/src/arrange.rs`).
  - Not applicable: the shared-library cutovers (craft-drawingml, craft-cfb, craft-deckcraft-format, Base64, RTF,
    OPC names, XML escaping), PPTX import budgets, the Greek sigma / Arabic Letter Mark / engineering-notation text
    fixes (DeckCraft's own formatting engine), CI and release housekeeping.
- `5c69849..5b422e8` (73 commits, 2026-11-17 to 2026-11-20), ported by importance, redesigned to LightCast's own code:
  - Ported: a slide's animations wait for its transition (`e1ca7149`: `transitionHold` and `initialBuild(…, afterMs)` in
    `animations.ts`, used by `goLive` and the reading view); separate Latin / East Asian / complex-script typefaces
    (`3a1a74d2`, `e39e693d`, `1a16bf97`: `TextRun.fontFamilyEa` / `fontFamilyCs`, Hangul drawn in the 한글 글꼴, `a:ea` /
    `a:cs` read and written, 글꼴 dialog 영어 글꼴 / 한글 글꼴); text shadow from the run, `defRPr`, list style and default
    text style (from `53044b2c`; glow is not modelled); table cell cap of 100,000 (`1629e4d9`: vendored
    `deckcraft/model/src/table.rs` now matches DeckCraft at that commit, `freecast-engine/src/table.rs`, `drawTable.ts`,
    `pptxTable.ts`, `odp.ts`); PPTX media timing round trip (`8c85789c`, `9fb1c5f9`, `0fabcf1d`, `ea85b041`, `fc6a3c4d`:
    `readMediaTiming` in `pptxTiming.ts`, `pptxMedia.ts`; export now embeds video and audio); 머리글/바닥글 keeps and
    remembers the date format (`372c0e6c`, `370b38e6`: `applyFooter` in `insertTools.ts`, format and language lists).
  - Already in LightCast (tests added): line-chart value labels (`8d51427d`, `b5dfac13`), text in scaled groups
    (`ba63277c`), empty notes slides (`e4b1a609`), every slide as PNG / JPEG (`53f09a02`).
  - Not applicable / skipped: `.ppt` 97-2003 reader (LightCast has its own, `io/pptImport.ts`), outline RTF, Serbian
    proofing languages, gradient-stop double-click (LightCast's stops are colour inputs that open on one click), the
    transparent-background picture option, footer date import (LightCast does not read footers into `Slide.footer`),
    egui canvas clipping, Preferences slider and Save As list, craft-libs cutovers (rtf, numfmt, mcp, media, table-style
    writer), docs, CI.
