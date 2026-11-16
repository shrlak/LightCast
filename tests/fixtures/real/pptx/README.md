# PowerPoint (.pptx) fixtures for the full deck reader

Used by `tests/pptxDeck.test.ts` (reader: `src/domain/io/pptxDeck.ts`, report: `src/domain/io/importReport.ts`).
Each file is under 60 KB. They were written by python-pptx 1.0.2 (with hand-added XML where python-pptx has no API),
by hand (SmartArt and the Office 2016 chart), or by LibreOffice 24.2. None was saved by Microsoft PowerPoint, so
PowerPoint's own spelling of some parts (SmartArt layouts, modern comments, embedded fonts, OLE objects, equations)
is not covered by a real sample here.

| fixture | built by | what it holds |
| --- | --- | --- |
| `text.pptx` (4:3) | `build/build.py` | every run property (bold, italic, underline, strike, colour, font, super / subscript, character spacing, highlight, hyperlink, Korean font), bullets on three levels, numbering (1. / a)), alignment, line spacing 150 % and exactly 30 pt, space before / after, anchor bottom with fill and outline, rotation, two columns, vertical text, shrink-on-overflow font scale; title, subtitle and content placeholders that inherit from layout and master |
| `shapes-16x9.pptx` | `build/build.py` | 16 preset shapes with adjustments, 3-stop and radial gradients, pattern, 40 % transparent fill, shadow + glow, soft edge + reflection, dashed lines with arrowheads of four kinds, a double elbow connector, a freeform, a group, a cropped picture with an outline, a picture cut to an ellipse with grayscale, a gradient slide background, 3-D rotation with bevel; theme fill / line / effect styles (python-pptx's default theme) |
| `tables-16x9.pptx` | `build/build.py` | a table with merged cells across and down, a cell fill, bold red text, right alignment, red borders on one cell, wider first column; a second table in another built-in style |
| `charts-16x9.pptx` | `build/build.py`, then the embedded workbooks removed | clustered column (data labels), line with markers, stacked bar, area, pie, doughnut, scatter, radar |
| `features.pptx` (4:3) | `build/build.py` | speaker notes, a legacy comment, a hidden slide, two sections, fade / push (auto-advance 3 s) / wipe (no advance on click) transitions, three animations (fade on click, fly in with previous, appear on click), a text hyperlink, a shape that jumps to slide 1, a video with a poster frame |
| `master-16x9.pptx` | `build/build.py` | a master with a gradient background, a logo shape and its own title / body text styles; slides on two layouts |
| `smartart-chartex.pptx` (4:3) | `build/smartart.py` | a SmartArt basic process saved the way PowerPoint saves it (data, layout, style, colours and the pre-drawn `dsp:drawing` part), and an Office 2016 waterfall chart (`cx:chartSpace`) inside `mc:AlternateContent` with a text fallback |
| `libreoffice-rich.pptx` | LibreOffice: `../odp/libreoffice-rich.odp` saved as .pptx | how LibreOffice spells a .pptx: rotated shapes, gradients, tables with merges, a group, connectors, notes, transitions, a hidden slide |

Reproduce (from this directory; the scripts take their output folder / file as arguments):

```sh
mkdir out && python3 -I build/build.py out          # text43, shapes169, tables169, charts169, features43, master169 .pptx
python3 -I build/smartart.py smartart-chartex.pptx
soffice --headless --convert-to pptx ../odp/libreoffice-rich.odp
```

`charts-16x9.pptx` is `charts169.pptx` with `ppt/embeddings/*` and the charts' `c:externalData` / package
relationships removed (the reader uses the charts' cached values only).
