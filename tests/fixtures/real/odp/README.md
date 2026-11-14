# Real LibreOffice .odp fixtures

Both files were written by **LibreOffice 24.2.7.2** (not by LightCast), converted from PowerPoint decks that
python-pptx 1.0.2 builds, so they show how LibreOffice really spells `.odp`:

| fixture | built by | what it holds |
| --- | --- | --- |
| `libreoffice-rich.odp` | `build_rich.py` | rotated shapes (30 / 300 / 90 degrees), linear / multi-stop / radial gradients, per-stop transparency, slide background gradient and colour, a group, a table with merges, a rotated table, a rotated picture, connectors with arrows and dashes, shadows, bullet and numbered lists, shrink-to-fit, notes, a master-page bar, fade and push transitions with automatic advance, a hidden slide |
| `libreoffice-animations.odp` | `build_animations.py` | five click / with-previous / after-previous effects: appear, fade in, fly in, wipe, fade out |

Reproduce (run from this directory; the scripts take their output paths as arguments):

```sh
python3 -I build_rich.py rich.pptx pic.png
soffice --headless --convert-to odp --outdir . rich.pptx        # -> rich.odp (libreoffice-rich.odp)

python3 -I build_animations.py anim.pptx
soffice --headless --convert-to odp --outdir . anim.pptx        # -> anim.odp (libreoffice-animations.odp)
```

What LibreOffice does that the reader depends on (all checked against these files):

* Preset shapes are `draw:type="ooxml-<preset>"` with their own equations; the preset is the name after `ooxml-`.
* A shape turned by N degrees clockwise is `draw:transform="rotate (-N rad) translate (x y)"`: ODF angles run counter-clockwise, the
  list is applied in the order written, and `translate` is where the turned top-left corner lands (no `svg:x` / `svg:y`).
* Gradient stops are `loext:gradient-stop` with `svg:offset` 0..1 and the colour in `loext:color-value`; a radial gradient's
  `draw:start-color` is the **outer** colour and `draw:end-color` the centre. Linear `draw:angle` is counter-clockwise from "start on top".
* Per-stop transparency is a separate `draw:opacity` (named by `draw:opacity-name`) with `loext:opacity-stop`.
* Table cell fills live in `loext:graphic-properties` and often come only from `table:default-cell-style-name` on the row or column.
* Shadows are written on every shape (`draw:shadow="visible"`), with a zero offset when there is none.
* Lists are `text:list` with a `text:list-style` (`text:list-level-style-number` for numbering).
* Animations are `anim:par` trees: `presentation:preset-id` (`ooo-entrance-fade-in` ...) and `presentation:node-type`
  (`on-click`, `with-previous`, `after-previous`), the object named by `smil:targetElement` = its `xml:id`.
* Automatic slide advance is `presentation:transition-type="automatic"` + `presentation:duration` (also for "click and after").
