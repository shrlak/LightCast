// Drop-down items (shapes, chart types, colours, bullets…) exist only while their menu is open; the command
// search reads them by opening each menu. These tests render the real menus and read them the way the index does.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { commandId, keepKnown, menuCommands, menuItemLabel, searchCommands, type CommandEntry } from '../src/domain/commandSearch';
import { ChartMenu } from '../src/ui/ppt/chartMenu';
import { ShapeGallery } from '../src/ui/ppt/galleries';
import { ColorGrid, MenuItem } from '../src/ui/ppt/ribbonParts';
import { CHART_LABEL } from '../src/domain/chartTypes';

/** The items of a menu as the ribbon's index reads them (label span, else own text, else tool tip). */
function itemsOf(html: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => {
    const title = /\btitle="([^"]*)"/.exec(attrs)?.[1];
    const span = /class="rb-mi-label">([^<]*)</.exec(inner)?.[1];
    const own = inner.replace(/<svg[\s\S]*?<\/svg>|<span[\s\S]*?<\/span>|<img[^>]*>/g, '').replace(/<[^>]+>/g, '');
    return { label: menuItemLabel(span ?? own) || menuItemLabel(title), disabled: /\bdisabled\b/.test(attrs) || undefined };
  }).filter((x) => x.label);
}
const BULLETS = { label: '글머리 기호', group: '단락' };
const plain = (tab: string, group: string, label: string): CommandEntry => ({ id: commandId(tab, group, label), label, tab, group });

describe('drop-down items are searchable', () => {
  it('cleans a menu item name: no hint in brackets, no trailing dots, nothing without letters', () => {
    expect(menuItemLabel('사각형 (두 번 클릭: 그리기 모드 잠금)')).toBe('사각형');
    expect(menuItemLabel('다른 색…')).toBe('다른 색');
    expect(menuItemLabel('● ―● ―● ―')).toBe('');
    expect(menuItemLabel('')).toBe('');
  });

  it('makes one entry per item, naming the button that opens the menu', () => {
    const list = menuCommands('홈', BULLETS, [{ label: '없음' }, { label: '그림 글머리 기호' }, { label: '없음' }]);
    expect(list.map((x) => x.label)).toEqual(['없음', '그림 글머리 기호']);
    expect(list[1]).toMatchObject({ via: '글머리 기호', pick: '그림 글머리 기호', tab: '홈', group: '단락' });
    expect(searchCommands(list, '그림 글머리')[0].pick).toBe('그림 글머리 기호');
    // A bare number (a font size) carries its button's name.
    const size = menuCommands('홈', { label: '글꼴 크기', group: '글꼴' }, [{ label: '24' }]);
    expect(size[0].label).toBe('글꼴 크기 24');
    expect(searchCommands(size, '크기 24')[0].pick).toBe('24');
  });

  it('finds an item by its button name plus the item ("도형 채우기 빨강")', () => {
    const list = menuCommands('홈', { label: '도형 채우기', group: '그리기' }, [{ label: '빨강 #ff0000' }, { label: '파랑 #0000ff' }]);
    expect(searchCommands(list, '도형 채우기 빨강')[0].pick).toBe('빨강 #ff0000');
  });

  it('keeps entries of an earlier index, greyed, when their menu is not available now', () => {
    const known = new Map<string, CommandEntry>();
    expect(keepKnown(known, menuCommands('홈', BULLETS, [{ label: '없음' }]))).toHaveLength(1);
    const later = keepKnown(known, [plain('홈', '클립보드', '붙여넣기')]);
    expect(later.map((x) => [x.label, !!x.disabled])).toEqual([['붙여넣기', false], ['없음', true]]);
  });

  it('chart types: every type of the chart menu is found and picks that item', () => {
    const items = itemsOf(renderToStaticMarkup(createElement(ChartMenu, { onPick: () => undefined })));
    const entries = menuCommands('삽입', { label: '차트', group: '일러스트레이션' }, items);
    const labels = Object.values(CHART_LABEL);
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) expect(entries.some((x) => x.pick === l), l).toBe(true);
    expect(searchCommands(entries, labels[0])[0].via).toBe('차트');
  });

  it('shapes: every preset of the shape gallery is an entry, without the tool tip hint', () => {
    const items = itemsOf(renderToStaticMarkup(createElement(ShapeGallery, { onPick: () => undefined, onFreeform: () => undefined })));
    expect(items.length).toBeGreaterThan(100);
    expect(items.some((x) => /두 번 클릭/.test(x.label))).toBe(false);
    const entries = menuCommands('홈', { label: '도형', group: '그리기' }, items);
    expect(searchCommands(entries, '오각형')[0].label).toMatch(/오각형/);
  });

  it('colours: the colour grid gives every theme and standard colour', () => {
    const entries = menuCommands('홈', { label: '글꼴 색', group: '글꼴' }, itemsOf(renderToStaticMarkup(createElement(ColorGrid, { onPick: () => undefined, onNone: () => undefined }))));
    expect(entries.length).toBeGreaterThan(20);
    expect(searchCommands(entries, '글꼴 색 ff0000').length).toBeGreaterThan(0);
  });

  it("a menu item's label is its text, not its shortcut hint", () => {
    const html = renderToStaticMarkup(createElement(MenuItem, { label: '붙여넣기', hint: 'Ctrl+V', onClick: () => undefined }));
    expect(itemsOf(html)).toEqual([{ label: '붙여넣기', disabled: undefined }]);
  });
});
