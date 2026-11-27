# Keeping LightCast in step with DeckCraft

LightCast's editor follows [DeckCraft](https://github.com/storytold/deckcraft) (a Rust PowerPoint
clone, MIT / Apache-2.0). Its commands live in `crates/engine/src/cmd/**/*.rs`; the engine inside
LightCast (`engine/`) is built from DeckCraft's crates plus `engine/freecast-engine`.

Last DeckCraft commit LightCast has been compared against and brought up to date with:

```
DECKCRAFT_SYNCED=74591abae8e70617b6b7ad092026262d0c562115
```

(DeckCraft `origin/main` on 2026-11-27; its last non-merge commit is `a0f0ad57`, tab stop past the edge against the hanging indent.)

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
- `5b422e8..0ccc68f` (8 commits, 2026-11-20 to 2026-11-21):
  - Ported: the craft-rtf tokenizer's RTF reading (`c355c063`) in LightCast's own RTF reader, `rtfToText` in
    `io/songFormats.ts` (ProPresenter 6 `RTFData`): `\uN` is now read (before, it was swallowed as an unknown control
    word, so Hangul stored only as RTF was lost), its `\ucN` fallback is skipped (a `\'hh` or control symbol counts as
    one character, the skip ends at a group boundary), `\*` destinations are skipped wherever they appear, `\'hh` is
    cp1252, `\bin` data is skipped (`tests/rtfText.test.ts`); strict shape-owner scoping in post-export XML patches
    (`6ebac8b9`): `patchMediaClips` in `io/pptxMedia.ts` only renames a clip and points its timing at it when the
    `lcm-N` marker is in that picture's own `p:nvPicPr` and no other shape opens inside the picture (`ownsCNvPr`,
    `tests/deckcraftSync4.test.ts`).
  - Not applicable: the craft-pptx reader/writer cutover and its follow-ups (`05d99074`, `94e7d0cf`: they restore
    DeckCraft's own behaviour on top of the shared crate, such as `grpFill` on pictures in groups and preset
    adjustments beyond ±2e9; LightCast writes with its own exporter, groups are flat); notes / handout master shape
    bounds and POTX / PPSX export parity (`b16257a8`, `0ccc68f6`: LightCast's notes and handout masters are print
    settings, not shape trees, and it exports `.pptx` / `.ppt` only); MCP transcript tests (`83d9383c`, automation
    only); the shared AGENTS.md (`3ffeffcd`, docs). No Rust changed, so the wasm was not rebuilt.
- `0ccc68f..9db2fa0` (7 commits, 2026-11-20 to 2026-11-24):
  - Ported: WMF scale and offset mapping records place sub-pictures (`921b4558`, #2069: the craft-metafile pin moved
    to craft-libs `f428c3d3`, which brings `aaa72308`, `7585d2df` and `8644532e`). LightCast's reader already read
    SCALEVIEWPORTEXT / SCALEWINDOWEXT / OFFSETVIEWPORTORG / OFFSETWINDOWORG, but in WMF mode its mapping ignored the
    viewport and later window extents, so they did nothing. Now (`Gdi.pageXf` in `metafile/gdi.ts`, `offsetOrg`) a WMF
    plays into its frame (first window extent, else the placeable box): the viewport is that frame, scaled by
    SCALEVIEWPORTEXT (also when given before the first window) and moved by OFFSETVIEWPORTORG, and the current window
    maps onto it, so SCALEWINDOWEXT and a later SETWINDOWEXT scale the drawing and the frame itself never changes. The
    file's own SETVIEWPORTEXT / SETVIEWPORTORG are still not applied in a WMF. Tests: DeckCraft's two-halves render test
    (which LightCast already drew right) and craft-metafile's mapping tests, in `tests/metafile.test.ts`.
  - Not applicable: release workflow changes and the revert of one (`26620f59`, `14ff0938`, `2d031bb6`, CI), the
    ROADMAP / parity docs (`9db2fa0c`), merge commits (`06c77015`, `7fbdc085`: their net change is `921b4558`). No Rust
    changed, so the wasm was not rebuilt.
- 2026-11-24, full feature comparison (not one commit at a time): every DeckCraft command, ribbon tab, pane and dialog
  against LightCast. What was added, what stays different and why: `docs/deckcraft-parity.md` (v1.3.0).
- `9db2fa0..5b7b22d` (22 non-merge commits, 2026-11-24 to 2026-11-26), v1.3.4:
  - Ported: the slide canvas as one real Tab stop that keeps the keyboard (`44c80663`, `c74671d7`, `d532ff66`,
    `24bdb62f`), redesigned for the browser in `src/ui/ppt/canvasFocus.ts` (`useCanvasKeyboard`, used by
    `CanvasEditor`): Tab / Shift+Tab step through the objects only while one is left (`tabHasWork` in
    `domain/shapeOps.ts`, DeckCraft's `tab_has_work`; LightCast's is direction-aware), and past the last (first) one
    the browser moves the keyboard on instead of the canvas trapping it; a pointer press on a ribbon or QAT button that
    opens no field, dialog or menu leaves the keyboard with the slide; when a dialog, menu or popup closes, or the focus
    leaves the canvas, a toolbar or an overlay for nothing, the canvas takes it back, as does a newly shown slide when
    nothing has it; Tab with nothing focused goes to the slide. Text fields, open dialogs and menus keep their keys, and
    on a touch screen the focus is not moved by itself (it would raise the on-screen keyboard). Alt+1..9 for the Quick
    Access Toolbar (`0d8d4b75`: DeckCraft already had the shortcut and claimed it on its canvas; LightCast lacked it):
    `qatShortcut` in `domain/qat.ts`, handled in `Qat.tsx`, by key position, off on macOS, named in each button's
    tooltip. Excel's `?` placeholders show a space for a missing digit (`3791ce11`, from the craft-numfmt repin): the
    vendored `deckcraft/model/src/numfmt.rs` (`fixed`) and its chart tests; the wasm was rebuilt. LightCast's PPTX
    chart reader does not read axis or label formats yet, so this shows only once it does. Tests:
    `tests/deckcraftSync5.test.ts`, `tests/e2e/canvasFocus.e2e.ts`.
  - Not applicable: craft-libs / egui repins and Cargo.lock (`c57f6347`, `93567cf2`, `57a22b94`, `96a244dc`,
    `b5a0f61c`, `9fb14fa6`, `65df3159`, `49fb5cf7` (two craft-pptx chart fields DeckCraft leaves at their defaults),
    `20500569`, `8a41a44b` (egui API renames)); the craft-ui runtime hosting (`1afbb0ec`: its window Escape and dialog
    host are egui plumbing, LightCast's dialogs already close on Escape); egui-only fixes in `c74671d7` (Enter and Space
    as fake clicks of the focused canvas in the context menu and the Eyedropper; browsers do not do that); clippy
    (`53e994b4`); update-dialog test timing (`bfdca1ce`); nightly packaging, signing and CI (`02f7fcdf`, `08ba5072`,
    `a3386f3f`).
- `5b7b22d..74591ab` (10 non-merge commits, several from older branches merged on 2026-11-27), v1.3.6:
  - Ported, text tab stops (`src/domain/tabStops.ts`, `TabbedLine` in `src/ui/SlideCanvas.tsx`): a hanging first line's
    first tab goes to the paragraph's margin, an implicit left stop (`87af3184`; the nearer of it and an explicit stop
    wins, a stop within half a point of it keeps its own alignment); only on the first line and only left to right, and
    not when a bullet already fills the hanging indent (`fc253bdb`); a stop past the text area's right edge acts as one
    at the edge, so right-aligned text after it ends at the margin (`5a6add63`), the edge being absolute, not moved in by
    the line's indent (`1add4c13`); a stop past the edge is compared with the hanging indent where it takes effect
    (`a0f0ad57`). `tabAdvance` / `layoutTabLine` take the line's `hang` and `right` (`TabLine`), `firstLineTabs` works
    them out for a paragraph, and a tabbed line is now measured from where it really starts (box indent, margin and
    first-line indent) instead of 0. A line with tabs in a hanging paragraph is laid out this way even without stops of
    its own (before, CSS `tab-size` placed it). A wrapped later line of a tabbed paragraph is still not re-laid out.
  - Already in LightCast (helper and test added): an audio icon with 쇼 동안 숨기기 stays hidden while it plays, a video
    shows while it plays (`edb303d9`): `hiddenDuringShow` in `domain/mediaPlayback.ts`, used by `SlideCanvas`.
  - Ported, charts (engine `freecast-engine/src/chart.rs`, the wasm was rebuilt): a line series' legend key is a stretch
    of its line, with its marker where the series has markers (`0175c6c2`; line, lineMarkers, lineStacked, the line
    series of a combo and of Pareto's 누적 %, and radar (`ca819f14`; LightCast's radar marks its points, so its key has
    a marker); filled radar, columns, areas keep the square); a pie or doughnut takes each slice's own colour, `c:dPt`,
    for the slice and its legend key (`6df9331b`): `ChartSeries.pointColors`, read by `readChart` in
    `io/pptxChart.ts` and written back as the pie's slice colours by `io/pptxExport.ts`.
  - Not applicable: the macOS nightly launcher (`ab3aaa19`). Tests: `tests/deckcraftSync6.test.ts` and the legend-key
    tests in `engine/freecast-engine/src/tests.rs`.
