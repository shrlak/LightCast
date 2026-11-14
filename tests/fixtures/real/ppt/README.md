# Real .ppt fixtures

Legacy PowerPoint 97-2003 files written by a real application, used by `tests/pptImportReal.test.ts`.

How they were made:

1. Source decks (10 x 7.5 inch, blank layout unless noted) built with python-pptx 1.0.2: formatted text with a bullet
   and a dash sub-bullet, paragraph spacing and mixed runs (`libreoffice-text`); a 3 x 3 table with a merged cell
   and a filled cell (`libreoffice-table`); a freeform polygon, an arrow, a gradient rectangle and a rotated
   rectangle (`libreoffice-shapes`); three slides with wipe / push / blinds transitions, one hidden, with notes
   and a solid background (`libreoffice-show`).
2. `soffice --headless --convert-to ppt` (LibreOffice 24.2.7, filter "MS PowerPoint 97").
3. Repacked with the repo's `cfb.ts` / `cfbWrite.ts` to only the `PowerPoint Document`, `Current User` and
   `Pictures` streams (LibreOffice adds a ~580 KB thumbnail in `SummaryInformation`), which brings each file under 60 KB.

The files hold no personal data. LibreOffice writes many presets as custom geometry with guide formulas; the
reader does not evaluate those (see `pptEscher.ts`), so the shapes fixture sticks to what it does read.
