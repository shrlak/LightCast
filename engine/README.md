# FreeCast PowerPoint engine (Rust → WebAssembly)

What PowerPoint *does* in FreeCast runs here, in Rust, compiled to WebAssembly and loaded by the app
(`src/engine/`):

| Op group | What it does |
|---|---|
| `shapes.*`, `shape.*` | 183 preset shapes (Insert › Shapes) as SVG paths, their text area and yellow adjust handles |
| `icons.*` | Insert › Icons (Lucide stroke icons) |
| `arrange.*` | Align, distribute, bring forward / send backward, rotate, flip |
| `geom.*` | Hit testing of rotated objects, marquee selection, the eight sizing handles, rotation, smart guides and snap to grid |
| `anim.*` | Animations: entrance / emphasis / exit / motion paths, click steps, With / After Previous, delays — sampled per object over time |
| `transition.*` | 49 slide transitions as frames of the old and new slide |
| `table.*` | Table rows, columns, merge / split and table styles |
| `chart.*` | Column, bar, line, area, pie, doughnut and scatter charts as SVG |
| `color.*` | Theme colour schemes, the colour picker grid, shape Quick Styles, WCAG contrast |
| `find.*` | Find and Replace across a presentation |
| `ink.*` | Pen strokes smoothed into curves; Ink to Shape |

## Build

```bash
npm run engine
```

That runs `cargo build --release --target wasm32-unknown-unknown -p freecast-engine` and copies the
module to `src/engine/freecast_engine.wasm`, which is committed so FreeCast still builds on a machine
without Rust. CI and the release workflow rebuild it from this source. Rust tests:

```bash
cargo test --manifest-path engine/Cargo.toml -p freecast-engine
```

The module has no imports. Each call is one JSON request (`{"op": "...", ...}`) written into linear
memory (`fc_reserve`), handled by `fc_call`, and answered as `{"ok": ...}` or `{"err": "..."}` at
`fc_ptr` (see `freecast-engine/src/lib.rs`).

## Credits and licences

- `deckcraft/geom`, `deckcraft/color`, `deckcraft/model`, `deckcraft/anim` and
  `freecast-engine/src/inkshape.rs` come from **DeckCraft** (https://github.com/storytold/deckcraft,
  commit `0623b430324cf4c3d1962e6ae7885cf30c011c5e`), © 2026 ArtCraft Team and the DeckCraft
  contributors, used under the MIT License (see `deckcraft/LICENSE-MIT`; also available under
  Apache-2.0, `deckcraft/LICENSE-APACHE`). The crates are unchanged; `inkshape.rs` lost one test that
  needs DeckCraft's document session. The ArtCraft name and logos are not used.
- `freecast-engine/src/icon_data.rs` holds Lucide icon paths as DeckCraft ships them (Lucide 1.56.0,
  commit `440a1e1dfb1e712505308da46bead3c28b1f1398`), ISC License, © 2026 Lucide Icons and Contributors;
  the Feather-derived icons are MIT, © 2013-present Cole Bemis. Licence texts: `freecast-engine/LICENSE-ICONS`.
- `freecast-engine` itself is FreeCast's code, under the same MIT OR Apache-2.0 terms.
