# Keeping LightCast in step with DeckCraft

LightCast's editor follows [DeckCraft](https://github.com/storytold/deckcraft) (a Rust PowerPoint
clone, MIT / Apache-2.0). Its commands live in `crates/engine/src/cmd/**/*.rs`; the engine inside
LightCast (`engine/`) is built from DeckCraft's crates plus `engine/freecast-engine`.

Last DeckCraft commit LightCast has been compared against and brought up to date with:

```
DECKCRAFT_SYNCED=ef9ac9ac7a1f610656144981b53688efdb9ef518
```

(`Merge pull request #2062 from cloutier/fix/2060-large-adjustment-guides`.)

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
  geometry guide lists); LightCast reads no charts or layout placeholder fills from PPTX and draws `custGeom` as a
  rectangle. Revisit if LightCast ever imports PPTX charts or custom geometry.
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
  change into `src/domain/metafile/` and add a test to `tests/metafile.test.ts`. Not drawn yet (DeckCraft's reader does
  draw some of these): pen end caps and joins on cosmetic pens, region combinations other than AND/COPY, clipping to
  anything but rectangles and paths, texture and path-gradient brushes (a path gradient is its centre colour),
  glyph-index text, raster operations that read the destination, EMF+ relative paths and container mappings.
- DeckCraft plays the GDI records of an EMF+ "dual" file; LightCast prefers the EMF+ records and uses the GDI
  fallback only when EMF+ draws nothing, or between an EMF+ `GetDC` and the next EMF+ record.
