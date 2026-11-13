import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildPptx } from '../src/domain/io/pptxExport';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Presentation } from '../src/domain/types';
import { readGvml } from '../src/domain/io/drawingml';
import { bulletPictureOf, bulletPictureSize, bulletPlaceholder, isBulletPictureFile, patchBulletXml, shrinkBulletPicture } from '../src/domain/pictureBullet';
import { listMarker, listMarkers } from '../src/domain/textFormat';

// A 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('그림 글머리 기호 (picture bullets)', () => {
  it('uses the picture only for the picture list style with an image data URL', () => {
    expect(bulletPictureOf({ list: 'picture', bulletPicture: PNG })).toBe(PNG);
    expect(bulletPictureOf({ list: 'bullet', bulletPicture: PNG })).toBeUndefined();
    expect(bulletPictureOf({ list: 'picture' })).toBeUndefined();
    expect(bulletPictureOf({ list: 'picture', bulletPicture: 'https://example.com/x.png' })).toBeUndefined();
  });

  it('still counts the lines (blank lines get no bullet) and falls back to • for text measuring', () => {
    expect(listMarker('picture', 3)).toBe('•');
    expect(listMarkers(['가', '', '나'], 'picture')).toEqual(['•', null, '•']);
  });

  it('shrinks a picture to a bullet: longest side 64, never enlarged, ratio kept', () => {
    expect(bulletPictureSize(640, 320)).toEqual({ w: 64, h: 32 });
    expect(bulletPictureSize(20, 40)).toEqual({ w: 20, h: 40 });
    expect(bulletPictureSize(0, 0)).toEqual({ w: 64, h: 64 });
  });

  it('accepts image files up to 8 MB only', () => {
    expect(isBulletPictureFile({ type: 'image/png', size: 1000 })).toBe(true);
    expect(isBulletPictureFile({ type: 'application/pdf', size: 1000 })).toBe(false);
    expect(isBulletPictureFile({ type: 'image/png', size: 9 * 1024 * 1024 })).toBe(false);
    expect(isBulletPictureFile({ type: 'image/png', size: 0 })).toBe(false);
  });

  it('rewrites the placeholder bullet into a:buBlip', () => {
    const code = bulletPlaceholder(1);
    const xml = `<a:pPr><a:buSzPct val="100000"/><a:buChar char="&#x${code};"/></a:pPr><a:pPr><a:buChar char="&#x2022;"/></a:pPr>`;
    const out = patchBulletXml(xml, 2);
    expect(out.used).toEqual([1]);
    expect(out.xml).toContain('<a:buBlip><a:blip r:embed="rIdLcBu1"/></a:buBlip>');
    expect(out.xml).toContain('<a:buChar char="&#x2022;"/>');
  });

  it('keeps the picture bullet in an exported .pptx (buBlip, image part, relationship, content type)', async () => {
    const p: Presentation = {
      id: 'pb', title: '그림 글머리', themeId: 'theme_classic', slides: [{
        id: 's', group: '광고', text: '', elements: [
          { id: 't', kind: 'text', x: 100, y: 100, w: 1000, h: 400, text: '하나\n둘', fontSize: 50, list: 'picture', bulletPicture: PNG },
        ],
      }],
    };
    const lib = { ...createSeedLibrary(), presentations: [p] };
    const pptx = await buildPptx(lib, { presentation: p });
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('<a:buBlip><a:blip r:embed="rIdLcBu0"/></a:buBlip>');
    expect(xml).not.toContain('&#xE100;');
    expect(zip.file('ppt/media/lcbu-0.png')).toBeTruthy();
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('Id="rIdLcBu0"');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="png"');
  });
});

describe('그림 글머리 기호 in an imported file (a:buBlip)', () => {
  const pngBytes = () => Uint8Array.from(atob(PNG.split(',')[1]), (c) => c.charCodeAt(0));
  const el = { id: 'e', kind: 'text' as const, x: 100, y: 100, w: 1000, h: 400, text: '하나\n둘', fontSize: 50, list: 'picture' as const, bulletPicture: PNG };
  const exportSlide = async () => {
    const p: Presentation = { id: 'pb', title: 't', themeId: 'theme_classic', slides: [{ id: 's', group: '광고', text: '', elements: [el] }] };
    const pptx = await buildPptx({ ...createSeedLibrary(), presentations: [p] }, { presentation: p });
    return JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
  };
  /** The exported slide as a one-drawing package (what readGvml reads). */
  const asDrawing = async (zip: JSZip) => {
    const out = new JSZip();
    out.file('ppt/drawings/drawing1.xml', await zip.file('ppt/slides/slide1.xml')!.async('string'));
    out.file('ppt/drawings/_rels/drawing1.xml.rels', await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string'));
    for (const n of Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && !zip.files[f].dir)) out.file(n, await zip.file(n)!.async('uint8array'));
    return out.generateAsync({ type: 'uint8array' });
  };

  it('round trip: export → import gives the picture bullet back', async () => {
    const r = await readGvml(await asDrawing(await exportSlide()));
    const t = r!.elements.find((e) => e.text?.includes('하나'))!;
    expect(t.list).toBe('picture');
    expect(bulletPictureOf(t)).toMatch(/^data:image\/png;base64,/);
    // The bullet picture is not kept as a picture of the file.
    expect(r!.media).toHaveLength(0);
  });

  it('shrinks the picture with the given shrinker; a picture it cannot take leaves a plain bullet', async () => {
    const zip = await asDrawing(await exportSlide());
    const seen: Blob[] = [];
    const ok = await readGvml(zip, undefined, async (b) => { seen.push(b); return 'data:image/png;base64,AAAA'; });
    expect(seen).toHaveLength(1);
    expect(ok!.elements.find((e) => e.text?.includes('하나'))).toMatchObject({ list: 'picture', bulletPicture: 'data:image/png;base64,AAAA' });
    const none = await readGvml(zip, undefined, async () => null);
    const t = none!.elements.find((e) => e.text?.includes('하나'))!;
    expect(t.list).toBe('bullet');
    expect(t.bulletPicture).toBeUndefined();
  });

  it('shrinkBulletPicture takes a small image as it is without a canvas and refuses a non-image or a big one', async () => {
    expect(await shrinkBulletPicture(new Blob([pngBytes()], { type: 'image/png' }))).toMatch(/^data:image\/png;base64,/);
    expect(await shrinkBulletPicture(new Blob(['x'], { type: 'text/plain' }))).toBeNull();
    expect(await shrinkBulletPicture(new Blob([new Uint8Array(40 * 1024)], { type: 'image/png' }))).toBeNull();
  });
});
