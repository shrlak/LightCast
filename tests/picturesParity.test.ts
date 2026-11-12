// DeckCraft parity for Picture Format, media and the Insert tab (area: pictures-insert).
import { describe, expect, it } from 'vitest';
import { COMPRESS_RESOLUTIONS, PICTURE_STYLES, REMOVE_BACKGROUND_LEVELS, RESET_PICTURE, SATURATION_STEPS, TRANSPARENCY_STEPS, compressPlan, fitUv, naturalSize, pictureLook, pictureStylePatch, realCrop, recolorLabel } from '../src/domain/pictureFormat';
import { lookCss } from '../src/ui/pictureStyles';
import { pictureCatalog, processPicture } from '../src/engine';

describe('Picture Format menus follow DeckCraft', () => {
  it('offers the three Remove Background levels and the saturation / transparency steps', () => {
    expect(REMOVE_BACKGROUND_LEVELS.map(([, t]) => t)).toEqual([20, 35, 10]);
    expect(SATURATION_STEPS[0]).toBe(0);
    expect(SATURATION_STEPS.at(-1)).toBe(4);
    expect(TRANSPARENCY_STEPS).toEqual([0, 15, 30, 50, 65, 80, 95]);
    expect(COMPRESS_RESOLUTIONS.map(([v]) => v)).toEqual([330, 220, 150, 96]);
  });

  it('lists 21 recolour presets with text colour 2 and names them in Korean', () => {
    const cat = pictureCatalog()!;
    expect(cat.recolor).toHaveLength(21);
    expect(cat.recolor).toContain('tx2Dark');
    expect(cat.recolor).toContain('tx2Light');
    expect(recolorLabel('tx2Dark')).toBe('텍스트 색 2 어둡게');
    expect(recolorLabel('accent3Light')).toBe('강조 3 밝게');
    expect(recolorLabel('bw50')).toBe('흑백: 50%');
    for (const r of cat.recolor) expect(recolorLabel(r)).not.toBe(r);
  });

  it('recolours a picture with text colour 2 in the engine', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const out = processPicture(px, 2, 1, { recolor: 'tx2Dark' })!;
    // White maps to the scheme's dk2, black stays black.
    expect([...out.data.slice(4, 8)]).toEqual([0, 0, 0, 255]);
    expect([...out.data.slice(0, 3)]).not.toEqual([255, 255, 255]);
  });

  it('saturation above 200 % is more saturated (engine allows up to 400 %)', () => {
    const px = () => new Uint8ClampedArray([150, 100, 100, 255]);
    const two = processPicture(px(), 1, 1, { saturation: 1 })!;
    const four = processPicture(px(), 1, 1, { saturation: 3 })!;
    expect(four.data[0]).toBeGreaterThan(two.data[0]);
  });
});

describe('Compress Pictures sizing (DeckCraft pack)', () => {
  it('shrinks to what the shown size needs at the chosen ppi', () => {
    // 720 canvas px = 360 pt = 5 in; at 96 ppi that is 480 px across.
    const plan = compressPlan(4000, 3000, undefined, 720, 540, 96, true)!;
    expect(plan.w).toBe(480);
    expect(plan.h).toBe(360);
    expect(plan.cut).toBeUndefined();
    expect(plan.crop).toBeUndefined();
  });

  it('leaves a picture alone when it is already small enough and nothing is cropped', () => {
    expect(compressPlan(400, 300, undefined, 720, 540, 220, true)).toBeNull();
    expect(compressPlan(400, 300, [0, 0, 0, 0], 720, 540, 220, true)).toBeNull();
  });

  it('cuts the cropped part away and clears the crop', () => {
    const plan = compressPlan(1000, 1000, [0.25, 0, 0.25, 0.5], 100, 100, 96, true)!;
    expect(plan.cut).toEqual({ x: 250, y: 0, w: 500, h: 500 });
    expect(plan.crop).toBeUndefined();
    // 100 px box = 50 pt; at 96 ppi ≈ 67 px.
    expect(plan.w).toBe(67);
  });

  it('keeps the crop when cropped areas stay, sizing the whole picture for the visible part', () => {
    const plan = compressPlan(4000, 4000, [0.5, 0, 0, 0], 720, 720, 96, false)!;
    expect(plan.cut).toBeUndefined();
    expect(plan.crop).toEqual([0.5, 0, 0, 0]);
    // The visible half must be 480 px across, so the whole is 960.
    expect(plan.w).toBe(960);
  });

  it('only counts real crops', () => {
    expect(realCrop([0.1, 0, 0, 0])).toBe(true);
    expect(realCrop([-0.1, 0, 0, 0])).toBe(false);
    expect(realCrop([0.6, 0, 0.5, 0])).toBe(false);
    expect(realCrop(undefined)).toBe(false);
  });
});

describe('Set Transparent Color maps the click to the picture pixel', () => {
  it('maps through a letterboxed (contain) picture and refuses the letterbox', () => {
    // 200×100 picture in a 200×200 box: drawn 200×100 in the middle.
    expect(fitUv(0.5, 0.5, 200, 200, 200, 100, 'contain')).toEqual([0.5, 0.5]);
    expect(fitUv(0.5, 0.1, 200, 200, 200, 100, 'contain')).toBeNull();
    expect(fitUv(0.5, 0.25, 200, 200, 200, 100, 'contain')).toEqual([0.5, 0]);
  });
  it('maps through cover and fill', () => {
    const [u] = fitUv(0, 0.5, 200, 200, 200, 100, 'cover')!;
    expect(u).toBeCloseTo(0.25);
    expect(fitUv(0.3, 0.7, 200, 200, 200, 100, 'fill')).toEqual([0.3, 0.7]);
  });
});

describe('Reset Picture and Picture Styles', () => {
  it('reset clears corrections, crop, transparency, border and effects but not size', () => {
    for (const k of ['picture', 'crop', 'opacity', 'stroke', 'dropShadow', 'glow', 'softEdge', 'reflection', 'bevel', 'pictureStyle'] as const) expect(k in RESET_PICTURE).toBe(true);
    expect('w' in RESET_PICTURE).toBe(false);
  });

  it('reset picture & size returns to the picture proportions within the slide', () => {
    const r = naturalSize({ x: 100, y: 100, w: 300, h: 300 }, 4000, 2000, 1440, 1080);
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r.w).toBeLessThanOrEqual(1440);
    expect(r.x).toBeGreaterThanOrEqual(0);
  });

  it('has PowerPoint\'s 24 styles in gallery order', () => {
    expect(PICTURE_STYLES).toHaveLength(24);
    expect(PICTURE_STYLES[0].id).toBe('simpleFrameWhite');
    expect(PICTURE_STYLES[23].id).toBe('metalOval');
    expect(new Set(PICTURE_STYLES.map((s) => s.label)).size).toBe(24);
  });

  it('applying a style replaces the frame and effects; Rotated sets the rotation', () => {
    const p = pictureStylePatch('rotatedWhite')!;
    expect(p.pictureStyle).toBe('rotatedWhite');
    expect(p.rotation).toBe(356);
    expect('stroke' in p && p.stroke === undefined).toBe(true);
    expect(pictureStylePatch('none')!.pictureStyle).toBeUndefined();
    expect(pictureStylePatch('nope')).toBeNull();
  });

  it('draws frames, shapes, soft edges and reflections', () => {
    expect(lookCss(pictureLook('simpleFrameWhite')!).border).toBe('14px solid #ffffff');
    expect(lookCss(pictureLook('doubleFrameBlack')!).border).toContain('double');
    expect(lookCss(pictureLook('softEdgeOval')!).borderRadius).toBe('50%');
    expect(String(lookCss(pictureLook('softEdgeRectangle')!).maskImage)).toContain('linear-gradient');
    expect(lookCss(pictureLook('reflectedRoundedRectangle')!).WebkitBoxReflect).toContain('below');
    expect(lookCss(pictureLook('snipDiagonalCornerWhite')!).clipPath).toContain('polygon');
  });
});
