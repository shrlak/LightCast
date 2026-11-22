// DeckCraft 5b422e8..0ccc68f: strict shape-owner scoping in post-export XML patches (6ebac8b9).
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { ownsCNvPr, patchMediaClips } from '../src/domain/io/pptxMedia';

const slide = (body: string) => `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const pic = (id: number, name: string) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rId2"/></p:nvPr></p:nvPicPr><p:spPr/></p:pic>`;

async function patched(body: string): Promise<string> {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', slide(body));
  await patchMediaClips(zip, [{ marker: 'lcm-1', kind: 'audio', name: '찬양', playback: { loop: true } }]);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('media patch: strict shape-owner scoping', () => {
  it('patches the picture that owns the marked p:cNvPr', async () => {
    const xml = await patched(`<p:sp><p:nvSpPr><p:cNvPr id="4" name="Box"/></p:nvSpPr><p:spPr/></p:sp>${pic(5, 'lcm-1')}`);
    expect(xml).toContain('<p:cNvPr id="5" name="찬양"');
    expect(xml).toContain('<a:audioFile ');
    expect(xml).toContain('<p:spTgt spid="5"/>');
  });

  it("takes a marker only from the picture's own p:nvPicPr, with no other shape inside the picture", () => {
    expect(ownsCNvPr('<p:nvPicPr>', '/><p:cNvPicPr/></p:nvPicPr><p:spPr/>')).toBe(true);
    expect(ownsCNvPr('<p:nvPicPr><p:cNvPr id="3"/></p:nvPicPr><p:spPr/><p:sp><p:nvSpPr>', '/></p:nvSpPr></p:sp>')).toBe(false);
    expect(ownsCNvPr('<p:blipFill/>', '/>')).toBe(false);
    expect(ownsCNvPr('<p:nvPicPr>', '/></p:nvPicPr><p:grpSp>')).toBe(false);
  });

  it('leaves a marker that is not on a picture alone', async () => {
    const body = `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Img"/></p:nvPicPr><p:spPr/><p:sp><p:nvSpPr><p:cNvPr id="6" name="lcm-1"/></p:nvSpPr><p:spPr/></p:sp></p:pic>`;
    const xml = await patched(body);
    expect(xml).toContain('name="lcm-1"');
    expect(xml).not.toContain('<p:timing>');
  });
});
