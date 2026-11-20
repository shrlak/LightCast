// DeckCraft sync 3 — PPTX read/write and Header & Footer:
// media timing (8c85789c, 9fb1c5f9, 0fabcf1d, c6e21c4f, 096b7042, ea85b041, fc6a3c4d), empty notes slides (e4b1a609),
// the Header & Footer date format (64d3127f, 372c0e6c, 370b38e6).
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

const stored = vi.hoisted(() => new Map<string, Blob>());
vi.mock('../src/domain/media', async (orig) => ({ ...(await orig<typeof import('../src/domain/media')>()), getMedia: async (id: string) => stored.get(id) }));

import { readMediaTiming } from '../src/domain/io/pptxTiming';
import { mediaTimingXml } from '../src/domain/io/pptxMedia';
import { readPptxDeck } from '../src/domain/io/pptxDeck';
import { buildPptx } from '../src/domain/io/pptxExport';
import { find, parseMarkup } from '../src/domain/io/markup';
import { createSeedLibrary } from '../src/domain/defaults';
import { applyFooter, rememberedDateFormat } from '../src/domain/insertTools';
import type { MediaPlayback, Presentation, Slide, SlideElement } from '../src/domain/types';

const targets = new Map([['4', ['v']], ['5', ['a']]]);
const sldOf = (xml: string) => find(parseMarkup(xml), 'sld')[0];
const sld = (tn: string) => sldOf(`<p:sld xmlns:p="p"><p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${tn}</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`);
const media = (tag: 'video' | 'audio', spid: string, cond = '<p:cond delay="0"/>', cm = '', ctn = '', node = '') =>
  `<p:${tag}${node}><p:cMediaNode${cm}><p:cTn id="9${spid}" fill="hold"${ctn}><p:stCondLst>${cond}</p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cMediaNode></p:${tag}>`;
const par = (cond: string, inner: string) => `<p:par><p:cTn id="2" fill="hold"><p:stCondLst>${cond}</p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
const auto = (tn: string) => Object.fromEntries([...readMediaTiming(sld(tn), targets)].map(([k, v]) => [k, !!v.autoplay]));
/** PowerPoint's main sequence with one Play effect on spid 4, wrapped as PowerPoint wraps an automatic step. */
const mainSeq = (opts: { wrapper?: string; step?: string; nodeType?: string; seqId?: string } = {}) =>
  `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${opts.seqId ?? '2'}" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst>${opts.wrapper ?? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>'}</p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst>${opts.step ?? '<p:cond delay="0"/>'}</p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="${opts.nodeType ?? 'afterEffect'}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="5000" fill="hold"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq>`
  + media('video', '4', '<p:cond delay="indefinite"/>');

describe('PPTX media timing: p:video / p:audio settings come back on import', () => {
  it('reads volume, mute, hide while not playing, loop, rewind, play across slides and full screen', () => {
    const pb = readMediaTiming(sld(
      media('video', '4', '<p:cond delay="indefinite"/>', ' vol="50000" numSld="999"', ' repeatCount="indefinite"', ' fullScrn="1"').replace('fill="hold"', 'fill="remove"')
      + media('audio', '5', '<p:cond delay="indefinite"/>', ' vol="0" mute="1" showWhenStopped="0"', '', ' fullScrn="1"'),
    ), targets);
    expect(pb.get('v')).toEqual({ volume: 0.5, acrossSlides: true, rewind: true, loop: true, fullScreen: true });
    // fullScrn means nothing on audio.
    expect(pb.get('a')).toEqual({ volume: 0, muted: true, hideDuringShow: true });
  });

  it('a media node that starts at once with nothing waiting above it plays automatically (096b7042)', () => {
    expect(auto(par('<p:cond delay="0"/>', media('video', '4')) + par('<p:cond evt="onBegin" delay="0"/>', media('audio', '5')))).toEqual({ v: true, a: true });
    expect(auto(par('<p:cond delay="2000"/>', media('video', '4')) + par('<p:cond evt="onClick" delay="0"/>', media('audio', '5')))).toEqual({ v: false, a: false });
    expect(auto(par('<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>', media('video', '4')) + par('<p:cond delay="0"/>', media('audio', '5', '<p:cond evt="onBegin" delay="0"/>')))).toEqual({ v: false, a: false });
    expect(auto(par('<p:cond delay="0"/>', media('video', '4', '<p:cond delay="500"/>')))).toEqual({ v: false });
  });

  it('a Play effect leading the main sequence with no click before it is 자동 실행 (9fb1c5f9)', () => {
    expect(auto(mainSeq())).toEqual({ v: true });
    expect(auto(mainSeq({ nodeType: 'withEffect' }))).toEqual({ v: true });
    // On click, or after a delay: not automatic.
    expect(auto(mainSeq({ nodeType: 'clickEffect' }))).toEqual({ v: false });
    expect(auto(mainSeq({ step: '<p:cond delay="1500"/>' }))).toEqual({ v: false });
  });

  it('a deferred ancestor and a wrapper naming another node still hold it back (ea85b041, fc6a3c4d)', () => {
    expect(auto(mainSeq({ wrapper: '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="77"/></p:cond>' }))).toEqual({ v: false });
    expect(auto(mainSeq({ wrapper: '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond><p:cond evt="onClick" delay="0"/>' }))).toEqual({ v: false });
    expect(auto(mainSeq({ step: '<p:cond evt="onEnd" delay="0"><p:tn val="9"/></p:cond>' }))).toEqual({ v: false });
  });

  it('the PowerPoint fixture keeps its clip volume', async () => {
    const r = await readPptxDeck(readFileSync('tests/fixtures/real/pptx/features.pptx'), { file: 'f.pptx', group: 'Deck', store: async (_b, _n, type) => `${type}-x` });
    const video = r.slides[4].elements!.find((e) => e.kind === 'video')!;
    expect(video.playback).toEqual({ volume: 0.8 });
    expect(r.report.items.some((i) => i.label === '미디어 재생 효과')).toBe(false);
  });
});

const clip = (kind: 'video' | 'audio', id: string, playback: MediaPlayback, y = 100): SlideElement => ({ id, kind, mediaId: id, name: kind === 'video' ? '찬양 영상' : '배경 음악', x: 100, y, w: 640, h: 360, playback });
async function roundTrip(slides: Slide[]) {
  const p: Presentation = { id: 'p', title: '예배', themeId: 'theme_classic', slides };
  const pptx = await buildPptx({ ...createSeedLibrary(), presentations: [p] }, { presentation: p });
  const bytes = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
  const zip = await JSZip.loadAsync(bytes);
  const back = await readPptxDeck(bytes, { file: 'p.pptx', group: 'Deck', store: async (_b, n, type) => `${type}:${n}` });
  return { zip, back };
}

describe('PPTX export writes audio and video with their playback', () => {
  stored.set('vid', new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], { type: 'video/mp4' }));
  stored.set('aud', new Blob([new Uint8Array([73, 68, 51, 4])], { type: 'audio/mpeg' }));

  it('a clip set to play automatically, loop, rewind, play across slides and full screen keeps it through export and import', async () => {
    const video = clip('video', 'vid', { autoplay: true, loop: true, rewind: true, acrossSlides: true, fullScreen: true, volume: 0.5 });
    const audio = clip('audio', 'aud', { muted: true, hideDuringShow: true, fullScreen: true }, 500);
    const { zip, back } = await roundTrip([{ id: 's', group: 'Slide', text: '', elements: [video, audio] }]);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('<a:audioFile ');
    expect(xml).toContain('name="찬양 영상"');
    expect(xml).toMatch(/<p:video fullScrn="1"><p:cMediaNode vol="50000" numSld="999"><p:cTn id="\d+" fill="remove" display="0" repeatCount="indefinite">/);
    // fullScrn only on p:video (0fabcf1d).
    expect(xml).toMatch(/<p:audio><p:cMediaNode vol="100000" mute="1" showWhenStopped="0">/);
    expect(xml).toContain('presetClass="mediacall"');
    expect(xml.indexOf('<p:timing>')).toBeGreaterThan(xml.indexOf('</p:clrMapOvr>'));
    const els = back.slides[0].elements!;
    expect(els.find((e) => e.kind === 'video')!.playback).toEqual({ autoplay: true, loop: true, rewind: true, acrossSlides: true, fullScreen: true, volume: 0.5 });
    expect(els.find((e) => e.kind === 'audio')!.playback).toEqual({ muted: true, hideDuringShow: true });
  });

  it('a clip on its defaults gets no timing node (c6e21c4f), and one on click is not automatic', async () => {
    const { zip, back } = await roundTrip([
      { id: 's1', group: 'Slide', text: '', elements: [clip('video', 'vid', {})] },
      { id: 's2', group: 'Slide', text: '', elements: [clip('audio', 'aud', { loop: true })] },
    ]);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).not.toContain('<p:timing>');
    const two = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(two).toContain('<p:audio>');
    expect(two).not.toContain('mainSeq');
    expect(back.slides[0].elements!.find((e) => e.kind === 'video')!.playback).toBeUndefined();
    expect(back.slides[1].elements!.find((e) => e.kind === 'audio')!.playback).toEqual({ loop: true });
  });

  it('writes the timing the reader reads (mediaTimingXml → readMediaTiming)', () => {
    const xml = mediaTimingXml([{ spid: '4', kind: 'video', playback: { autoplay: true } }, { spid: '5', kind: 'audio', playback: { autoplay: true, fullScreen: true } }]);
    expect(xml).not.toContain('fullScrn');
    expect(Object.fromEntries(readMediaTiming(sldOf(`<p:sld>${xml}</p:sld>`), targets))).toEqual({ v: { autoplay: true }, a: { autoplay: true } });
  });
});

describe('PPTX notes slides (e4b1a609)', () => {
  it('an empty notes slide is kept on save and gives no notes text on reopen', async () => {
    const { zip, back } = await roundTrip([{ id: 's1', group: 'Slide', text: '첫 장' }, { id: 's2', group: 'Slide', text: '둘째 장', notes: '광고 순서 확인' }]);
    // PptxGenJS writes a notes slide (and its relationship) for every slide, empty or not.
    for (const n of [1, 2]) {
      expect(zip.file(`ppt/notesSlides/notesSlide${n}.xml`)).not.toBeNull();
      expect(await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)!.async('string')).toContain('notesSlide');
    }
    expect(back.slides[0].notes).toBeUndefined();
    expect(back.slides[1].notes).toBe('광고 순서 확인');
  });
});

describe('Header & Footer date format (64d3127f, 372c0e6c, 370b38e6)', () => {
  const auto = { date: true, slideNumber: false, hideOnTitle: false };
  it('an Apply with no format picked leaves each slide’s own format alone', () => {
    const a = applyFooter({ date: true, dateFormat: 'ko11' }, auto, undefined, 'ko5');
    const b = applyFooter({ date: true, dateFormat: 'ko5' }, auto, undefined, 'ko5');
    expect([a?.dateFormat, b?.dateFormat]).toEqual(['ko11', 'ko5']);
    // A picked format still reaches every slide.
    expect(applyFooter({ date: true, dateFormat: 'ko11' }, auto, 'ko2', 'ko5')?.dateFormat).toBe('ko2');
    expect(applyFooter({ date: true, dateFormat: 'ko11' }, auto, '', 'ko5')).toEqual({ date: true });
  });

  it('a fixed date turned automatic again comes back on the remembered format', () => {
    const fixed = applyFooter({ date: true, dateFormat: 'ko11' }, { ...auto, fixed: '1776. 7. 4.' }, undefined, 'ko11');
    expect(fixed).toEqual({ date: '1776. 7. 4.', dateFormat: 'ko11' });
    expect(applyFooter(fixed, auto, undefined, undefined)?.dateFormat).toBe('ko11');
    // A slide with no date of its own takes the deck's remembered format.
    expect(applyFooter(undefined, auto, undefined, 'en4')).toEqual({ date: true, dateFormat: 'en4' });
    expect(applyFooter({ slideNumber: true }, { ...auto, date: false, slideNumber: true }, undefined, 'en4')).toEqual({ slideNumber: true });
  });

  it('the dialog opens on this slide’s format, else the deck’s', () => {
    const s1: Slide = { id: '1', group: 'S', text: '' };
    const s2: Slide = { id: '2', group: 'S', text: '', footer: { date: true, dateFormat: 'ko4' } };
    expect(rememberedDateFormat(s1, [s1, s2])).toBe('ko4');
    expect(rememberedDateFormat({ ...s1, footer: { date: true, dateFormat: 'en2' } }, [s1, s2])).toBe('en2');
    expect(rememberedDateFormat(s1, [s1])).toBe('');
  });
});
