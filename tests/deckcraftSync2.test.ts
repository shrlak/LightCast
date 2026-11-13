import { afterEach, describe, expect, it } from 'vitest';
import { duplicateSelection, enterGroup, groupSelection, leaveGroups, mergeSelection } from '../src/domain/editOps';
import { DUPLICATE_OFFSET } from '../src/domain/shapeOps';
import { charMove, deleteWord } from '../src/domain/textEditing';
import type { SlideElement } from '../src/domain/types';

const el = (id: string, x: number, y: number, more: Partial<SlideElement> = {}): SlideElement => ({ id, kind: 'shape', shape: 'rect', x, y, w: 100, h: 100, ...more });

describe('DeckCraft 9b1fe3f..ef9ac9a: groups', () => {
  afterEach(() => leaveGroups());

  it('duplicating a member of an entered group copies it into its group, next to the other members', () => {
    const g = groupSelection([el('a', 0, 0), el('b', 200, 0), el('z', 500, 500)], ['a', 'b']);
    const gid = g.find((e) => e.id === 'a')!.groupId!;
    enterGroup(gid);
    const d = duplicateSelection(g, ['a']);
    expect(d.ids).toHaveLength(1);
    const copy = d.elements.find((e) => e.id === d.ids[0])!;
    expect(copy.groupId).toBe(gid);
    expect(copy.x).toBe(DUPLICATE_OFFSET);
    expect(d.elements.filter((e) => e.groupId === gid)).toHaveLength(3);
    expect(d.elements.map((e) => e.id)).toEqual(['a', 'b', d.ids[0], 'z']);
  });

  it('duplicating a whole group still makes a new group', () => {
    const g = groupSelection([el('a', 0, 0), el('b', 200, 0)], ['a', 'b']);
    const gid = g[0].groupId!;
    const d = duplicateSelection(g, ['a']);
    expect(d.ids).toHaveLength(2);
    const copies = d.elements.filter((e) => d.ids.includes(e.id));
    expect(copies[0].groupId).toBeTruthy();
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe(gid);
  });

  it('merging members of a group leaves no one-member group behind', () => {
    const g = groupSelection([el('a', 0, 0), el('b', 50, 0), el('c', 400, 0)], ['a', 'b', 'c']);
    const r = mergeSelection(g, ['a', 'b'], 'union');
    expect(r.ids.length).toBeGreaterThan(0);
    expect(r.elements.find((e) => e.id === 'c')!.groupId).toBeUndefined();
  });
});

describe('DeckCraft 3e2dc9c: forward Delete removes a whole grapheme cluster', () => {
  it('moves over a cluster, not its first scalar', () => {
    expect(charMove(['👍🏽y'], [0, 0], true)).toEqual([0, 4]);
    expect(charMove(['éx'], [0, 0], true)).toEqual([0, 2]);
    expect(charMove(['한국'], [0, 0], true)).toEqual([0, 1]);
  });
  it('Ctrl+Delete removes a whole cluster', () => {
    const r = deleteWord(['👍🏽y'], [0, 0], true);
    expect(r.edits[0].from).toEqual([0, 0]);
    expect(r.edits[0].to[1]).toBeGreaterThanOrEqual(4);
  });
});
