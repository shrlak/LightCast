import { describe, expect, it } from 'vitest';
import type { Slide, SlideElement } from '../src/domain/types';
import { moveSection, removeAllSections, removeSection, removeSectionAndSlides, renameSection, sectionRange, sections } from '../src/domain/sections';
import { masterCopyId, syncMaster, withMaster } from '../src/domain/master';
import { elementLines, formatAllRuns, lineRuns } from '../src/domain/richText';
import { nodesFromText, relayoutSmartArt, smartArtElements, smartArtOwner, textFromNodes } from '../src/domain/smartArt';
import { outlineSlides } from '../src/ui/ppt/dialogsMore';
import { actionAt } from '../src/ui/ppt/views';
import { makeShape } from '../src/domain/editOps';

const s = (id: string, group: string, more: Partial<Slide> = {}): Slide => ({ id, group, text: id, ...more });

describe('Home › Section', () => {
  const deck = [s('a', 'Intro'), s('b', 'Intro'), s('c', 'Songs'), s('d', 'Songs'), s('e', 'End')];
  it('finds, renames and lists sections', () => {
    expect(sectionRange(deck, 'd')).toEqual([2, 4]);
    expect(renameSection(deck, 'c', '찬양').map((x) => x.group)).toEqual(['Intro', 'Intro', '찬양', '찬양', 'End']);
    expect(sections(deck)).toEqual([{ name: 'Intro', start: 0, count: 2 }, { name: 'Songs', start: 2, count: 2 }, { name: 'End', start: 4, count: 1 }]);
  });
  it('removes a section into the one before, with or without its slides', () => {
    expect(removeSection(deck, 'c').map((x) => x.group)).toEqual(['Intro', 'Intro', 'Intro', 'Intro', 'End']);
    expect(removeSection(deck, 'a').map((x) => x.group)).toEqual(['Songs', 'Songs', 'Songs', 'Songs', 'End']);
    expect(removeSectionAndSlides(deck, 'c').map((x) => x.id)).toEqual(['a', 'b', 'e']);
    expect(new Set(removeAllSections(deck).map((x) => x.group))).toEqual(new Set(['Intro']));
  });
  it('moves a section up and down', () => {
    expect(moveSection(deck, 'c', -1).map((x) => x.id)).toEqual(['c', 'd', 'a', 'b', 'e']);
    expect(moveSection(deck, 'c', 1).map((x) => x.id)).toEqual(['a', 'b', 'e', 'c', 'd']);
    expect(moveSection(deck, 'a', -1)).toBe(deck);
  });
});

describe('View › Slide Master', () => {
  const logo: SlideElement = { id: 'logo', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10 };
  it('puts the master objects behind every slide, replacing old copies, except where hidden', () => {
    const slides = [s('a', 'G', { elements: [{ id: 'own', kind: 'text', text: 'hi', x: 0, y: 0, w: 1, h: 1 }] }), s('b', 'G', { hideMaster: true })];
    const once = syncMaster(slides, [logo]);
    expect(once[0].elements?.map((e) => e.id)).toEqual([masterCopyId('logo'), 'own']);
    expect(once[0].elements?.[0].master).toBe(true);
    expect(once[1].elements).toBeUndefined();
    const twice = syncMaster(once, [{ ...logo, x: 50 }]);
    expect(twice[0].elements?.length).toBe(2);
    expect(twice[0].elements?.[0].x).toBe(50);
    expect(withMaster(twice[0], []).elements?.map((e) => e.id)).toEqual(['own']);
  });
});

describe('Font dialog on a whole box', () => {
  it('gives every character the run formatting (superscript) and keeps the text', () => {
    const box: SlideElement = { id: 't', kind: 'text', text: 'x2\ny', x: 0, y: 0, w: 1, h: 1 };
    const patch = formatAllRuns(box, { baseline: 'super', strike: true });
    const next = { ...box, ...patch };
    expect(next.text).toBe('x2\ny');
    expect(lineRuns(next).every((l) => l?.every((r) => r.baseline === 'super' && r.strike))).toBe(true);
    expect(elementLines(next)[0][0].text).toBe('x2');
    // Clearing again drops the runs.
    expect({ ...next, ...formatAllRuns(next, { baseline: undefined, strike: undefined }) }.runs).toBeUndefined();
  });
});

describe('Slides from Outline', () => {
  it('makes a slide per unindented line, with indented lines as its body', () => {
    const out = outlineSlides('# 환영\n\t첫 줄\n  둘째 줄\n광고\n- 수요예배\n', 'G');
    expect(out.map((x) => [x.title, x.text])).toEqual([['환영', '첫 줄\n둘째 줄'], ['광고', '수요예배']]);
  });
});

describe('Insert › SmartArt', () => {
  it('turns text pane lines into a grouped diagram that can be laid out again', () => {
    const nodes = nodesFromText('하나\n\t세부\n둘\n셋');
    expect(nodes.map((n) => n.level)).toEqual([0, 1, 0, 0]);
    expect(textFromNodes(nodes)).toBe('하나\n\t세부\n둘\n셋');
    const els = smartArtElements({ kind: 'blockList', style: 'flat', colors: 'colorful', nodes, box: { x: 100, y: 100, w: 1000, h: 600 } });
    expect(els && els.length).toBeGreaterThanOrEqual(3);
    const g = els![0].groupId;
    expect(els!.every((e) => e.groupId === g)).toBe(true);
    expect(els!.map((e) => e.text).join(' ')).toContain('둘');
    expect(smartArtOwner(els!, [els![2]])?.id).toBe(els![0].id);
    const again = relayoutSmartArt(els!, els![0].id, { kind: 'process' });
    expect(again?.elements.every((e) => e.groupId !== g)).toBe(true);
    expect(again?.elements[0].smartArt?.kind).toBe('process');
  });
});

describe('Action settings', () => {
  it('finds the clicked object with an action, and action buttons come with one', () => {
    const next = makeShape('actionButtonForwardNext', { x: 100, y: 100, w: 80, h: 80 });
    expect(next.action).toEqual({ kind: 'next' });
    const slide = s('a', 'G', { elements: [next, { id: 'z', kind: 'zoom', x: 500, y: 500, w: 200, h: 150, targetSlideId: 'b' }] });
    expect(actionAt(slide, 120, 120)?.id).toBe(next.id);
    expect(actionAt(slide, 600, 600)?.id).toBe('z');
    expect(actionAt(slide, 50, 50)).toBeNull();
  });
});
