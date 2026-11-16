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

Added later, made the same way:

- `libreoffice-numbering`: one text box with `buAutoNum` paragraphs (arabicPeriod, alphaLcParenR at level 1, romanUcPeriod
  starting at 5), a plain paragraph between them, hanging indents (`marL` / `indent`) and a wrapped bullet paragraph
  (`tests/pptNumbering.test.ts`).
- `libreoffice-presets`: eight preset autoshapes (roundRect, triangle, star5, rightArrow, heart, blockArc, wave, chevron)
  on a 2.35 inch grid (`tests/pptGeometry.test.ts`).
- `libreoffice-transitions`: eight slides with cover l / u / rd, pull d, wipe l, push l / r and fade through black
  (`tests/pptTransitionsReal.test.ts`).
- `libreoffice-notes`: speaker notes with a bold paragraph, a line break, numbered steps and two levels of bullets.
- `libreoffice-animations`: four text boxes animated as appear (on click), fade (with previous), fly in from the bottom
  (after previous) and wipe from the left (on click), written as a pptx `p:timing` tree (`tests/pptAnimationsReal.test.ts`).

The files hold no personal data. LibreOffice 24.2 writes most presets as custom geometry whose guide formulas are lossy
(constants cut to 16 bits, arcs written as plain segments; LibreOffice cannot draw them back either): the reader
recognises those presets by their formulas (`pptLoPresets.ts`) and evaluates the formulas of any other custom shape.
