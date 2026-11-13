import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildPptx } from '../src/domain/io/pptxExport';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Presentation } from '../src/domain/types';
import { bulletPictureOf, bulletPictureSize, bulletPlaceholder, isBulletPictureFile, patchBulletXml } from '../src/domain/pictureBullet';
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
