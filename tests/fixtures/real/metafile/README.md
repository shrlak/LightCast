# Real metafile fixtures

Small real WMF / EMF files used by `tests/metafileReal.test.ts` (each under 60 KB).

| file | made by | what it holds |
| --- | --- | --- |
| `lo-shapes.emf`, `lo-shapes.wmf` | LibreOffice 24.2 (`soffice --headless --convert-to emf` / `wmf`) from a 3 x 2 in PowerPoint slide built with python-pptx | rectangle, ellipse with a thick outline, arrow, thick dashed line, freeform Bézier |
| `lo-hatch.emf`, `lo-hatch.wmf` | same | a pattern (hatch) fill: hairline pens, which in the WMF are one logical unit wide |
| `lo-gradient.emf` | same | a linear gradient written as 256 slivers narrower than a pixel |
| `lo-text.emf`, `lo-text.wmf` | same | Latin and Korean text in several fonts, one rotated; the WMF holds the Korean text as CP949 bytes with a per-byte advance array |
| `lo-picture.emf`, `lo-picture.wmf` | same | a 12 x 9 raster picture (StretchDIBits) |
| `office-icon.emf` | Microsoft Office, the "generic icon" that ships in the python-pptx templates (MIT licensed package) | a page icon, GDI records written by Windows |
| `office-icon-alpha.emf` | Microsoft Office, the PowerPoint icon from the same package | an AlphaBlend of a 32-bit BI_BITFIELDS bitmap with per-pixel alpha, plus text |
| `deck-with-emf.pptx` | python-pptx, with the `.emf` and `.wmf` pictures above swapped in | PowerPoint import with a real EMF and a WMF picture |

The slides were drawn without shadows (`effectRef idx=0`); the drawings are synthetic, nothing in them is personal data.

LibreOffice writes EMF+ only as a header and a GetDC record in front of plain GDI records, so none of these
files has EMF+ drawing records. The EMF+ layouts (relative integers, texture brush, region nodes, image
attributes) are tested with files built in the test from the MS-EMFPLUS record tables.

## How they were checked

Each file was drawn with `metafileToSvg`, screenshot with Chromium and compared with LibreOffice's own PNG of the
same slide (`compare -metric RMSE`). The scripts live outside the repository; to repeat the check:
`soffice --headless --convert-to png <deck.pptx>` for the reference, `soffice --headless --convert-to emf` (or `wmf`)
for the metafile, render, and compare. Known differences that are not reader bugs: LibreOffice writes a picture clipped
to an ellipse as a mask / picture pair whose raster operations leave the corners visible (LibreOffice draws its own
file the same way), semi-transparent shapes become low resolution bitmaps in the EMF and opaque shapes in the WMF,
and small bitmaps are enlarged smoothly here where LibreOffice's PNG copies pixels.
