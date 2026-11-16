# PICT fixtures

QuickDraw PICT v2 files written by ImageMagick 6.9 (`convert x.png PICT:x.pict`), used by `tests/pict.test.ts`:

- `rgb.pict`: a 40 x 30 red-to-blue gradient with a yellow rectangle, 32-bit DirectBitsRect (PackBits planes).
- `pal.pict`: the same picture reduced to 8 colours, 8-bit PackBitsRect with a colour table.
- `mono.pict`: a 37 x 9 black bar on white, 1 bit.

`rgb.raw` and `pal.raw` are the pixels ImageMagick itself reads back from the PICT files (`convert x.pict -depth 8 rgb:x.raw`).
They hold no personal data.
