# Real LibreOffice .odp fixtures

Every `.odp` here was written by **LibreOffice 24.2.7.2** (not by LightCast), converted from PowerPoint decks that
python-pptx 1.0.2 builds, so they show how LibreOffice really spells `.odp`:

| fixture | built by | what it holds |
| --- | --- | --- |
| `libreoffice-rich.odp` | `build_rich.py` | rotated shapes (30 / 300 / 90 degrees), linear / multi-stop / radial gradients, per-stop transparency, slide background gradient and colour, a group, a table with merges, a rotated table, a rotated picture, connectors with arrows and dashes, shadows, bullet and numbered lists, shrink-to-fit, notes, a master-page bar, fade and push transitions with automatic advance, a hidden slide |
| `libreoffice-animations.odp` | `build_animations.py` | five click / with-previous / after-previous effects: appear, fade in, fly in, wipe, fade out |
| `libreoffice-animations2.odp` | `build_animations2.py` | fly in (left / top / right), fly out (left / bottom), zoom in / out, spin + grow/shrink, pulse repeated 3 times, colour change, bold flash, a motion path, and a spin triggered by a click on another shape |
| `libreoffice-transitions.odp` | `build_transitions.py` | a 16:9 (33.866 x 19.05 cm) deck: push up (slow), wipe right (fast), cover left-down, pull right, split vertical in, blinds vertical, fade |
| `libreoffice-connectors.odp` | `build_connectors.py` | straight, elbow and curved connectors glued to two rectangles and an oval, and a free elbow |
| `libreoffice-text.odp` | `build_text.py` | the ten PowerPoint dash presets, a text box with runs in other fonts / sizes / colours, superscript, subscript, character spacing and a hyperlink, a table with cell borders, a text with the Arch Up transform |

Reproduce (run from this directory; the scripts take their output paths as arguments):

```sh
python3 -I build_rich.py rich.pptx pic.png
soffice --headless --convert-to odp --outdir . rich.pptx        # -> rich.odp (libreoffice-rich.odp)

python3 -I build_animations.py anim.pptx
soffice --headless --convert-to odp --outdir . anim.pptx        # -> anim.odp (libreoffice-animations.odp)

# the same for build_animations2.py (anim2), build_transitions.py (trans), build_connectors.py (conn), build_text.py (text)
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
* Effect presets: `ooo-entrance-fly-in` / `ooo-exit-fly-out` with `presentation:preset-sub-type` `from-left` … `from-top-left`;
  PowerPoint's zoom is `ooo-entrance-fade-in-and-zoom` (animate width / height + fade); spin and grow/shrink are
  `anim:animateTransform` (`svg:type` rotate / scale, `smil:by="0.5,0.5"` for 150 %); colour changes are `anim:animateColor`
  (`fill-color`, `stroke-color`, `color`); bold flash is `anim:set` of `font-weight`; a motion path is `anim:animateMotion svg:path`
  in slide fractions with `presentation:preset-class="motion-path"`. Repeat is `smil:repeatCount` on the effect's par.
  PowerPoint's pulse (preset 26) comes out named `ooo-emphasis-flash-bulb`, so the reader trusts the children (scale + autoReverse) over the name.
* A trigger is an `anim:seq presentation:node-type="interactive-sequence"` beside the main sequence, its steps beginning at `<xml:id>.click+0s`.
* Transition speeds are 0.5 / 0.75 / 1 s (fast / medium / slow); direction is `smil:subtype` (`fromBottom` for PowerPoint's push up …) with
  `smil:direction="reverse"` for an uncover (pull) and for split "in". (LibreOffice's own .pptx export of a reversed slideWipe flips the
  direction relative to its import; the reader follows the import.)
* Connectors are `draw:connector` (`draw:type` line / curve; an elbow has none = standard) glued by `draw:start-shape` + `draw:start-glue-point`.
  An object's default glue points run top, right, bottom, left (PowerPoint's sites: top, left, bottom, right); a shape that lists its own
  `draw:glue-points` (the oval) numbers them from 4. A connector that leaves its start vertically (`svg:d` begins with `v`) is the PowerPoint
  connector turned 90 degrees.
* The ten dash presets keep exact `draw:stroke-dash` ratios (but other names: PowerPoint's dash is "Long Dash", sysDash is "Dash").
* Table cell borders are in the cell style's **paragraph** properties (`fo:border-left="1.11pt solid #ff0000"`).
* Hyperlinks are `text:a` inside the run's `text:span`; superscript is `style:text-position="30% 58%"`; spacing is `fo:letter-spacing`.
* Text transforms are Fontwork custom shapes (`draw:text-path="true"`, `draw:type="fontwork-arch-up-curve"`, some `mso-sptNNN`).
