// "어떤 작업을 원하시나요?" — PowerPoint's Tell Me box in the ribbon's tab row. Alt+Q (or Ctrl+Alt+Q) goes
// to it; typing finds ribbon commands by their Korean or English name; Enter (or a click) runs the chosen one.
// The commands are read off the ribbon itself (every tab is drawn once, out of sight), so nothing is listed twice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepKnown, searchCommands, withMenuCommands, type CommandEntry } from '../../domain/commandSearch';
import type { Ed } from './editor';
import type { RibbonActions } from './Ribbon';
import { HomeTab, InsertTab, DrawTab } from './tabsMain';
import { DesignTab, TransitionsTab, AnimationsTab } from './tabsShow';
import { SlideShowTab, ReviewTab, ViewTab, WorshipTab, ToolsTab } from './tabsMore';
import { ContextTabBody, type ContextTab } from './tabsContext';
import { MENU, findButton, findMenuItem, findOpener, scanMenus, scanRibbon } from './commandIndex';

const FIND_LIBRARY = '__find-library__';

/** Draws one ribbon tab's body (also used, hidden, to read the commands). */
function TabBody({ tab, ed, actions, ctx }: { tab: string; ed: Ed; actions: RibbonActions; ctx: ContextTab[] }) {
  switch (tab) {
    case '홈': return <HomeTab ed={ed} onFind={actions.onFind} onReplace={actions.onReplace} />;
    case '삽입': return <InsertTab ed={ed} onLink={actions.onLink} onComment={actions.onComment} />;
    case '그리기': return <DrawTab ed={ed} />;
    case '디자인': return <DesignTab ed={ed} />;
    case '전환': return <TransitionsTab ed={ed} onPreview={() => undefined} />;
    case '애니메이션': return <AnimationsTab ed={ed} onPreview={() => undefined} />;
    case '슬라이드 쇼': return <SlideShowTab ed={ed} />;
    case '검토': return <ReviewTab ed={ed} onComment={actions.onComment} />;
    case '보기': return <ViewTab ed={ed} onOutline={() => undefined} onReading={() => undefined} />;
    case '예배': return <WorshipTab ed={ed} />;
    case '도구': return <ToolsTab ed={ed} />;
    default: return ctx.includes(tab as ContextTab) ? <ContextTabBody tab={tab as ContextTab} ed={ed} /> : null;
  }
}

/** Draws every tab out of sight, reads its buttons into entries, then goes away. */
function Indexer({ tabs, ed, actions, ctx, onDone }: { tabs: string[]; ed: Ed; actions: RibbonActions; ctx: ContextTab[]; onDone: (e: CommandEntry[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    // The drop-downs' items are drawn only while a menu is open: every menu is opened (out of sight) and read.
    const t = setTimeout(async () => {
      const root = host.current;
      if (!root) return;
      const all: CommandEntry[] = [];
      for (const tab of tabs) {
        const body = root.querySelector(`[data-tab="${tab}"]`) ?? root;
        all.push(...scanRibbon(body, tab), ...(await scanMenus(body, tab, () => stopped)));
      }
      if (!stopped) onDone(all);
    }, 0);
    return () => { stopped = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={host} hidden aria-hidden="true" data-tellme-index>
      {tabs.map((tab) => <div key={tab} data-tab={tab}><TabBody tab={tab} ed={ed} actions={actions} ctx={ctx} /></div>)}
    </div>
  );
}

export function TellMe({ ed, actions, tabs, ctx, go }: { ed: Ed; actions: RibbonActions; tabs: string[]; ctx: ContextTab[]; go: (tab: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [entries, setEntries] = useState<CommandEntry[] | null>(null);
  const [indexing, setIndexing] = useState(false);
  // What the menus offer depends on what is selected, so a new selection means a new index (read when the box is next used).
  const key = tabs.join() + '|' + ctx.join() + '|' + ed.sel.join();
  const known = useRef(new Map<string, CommandEntry>());
  const lastKey = useRef(key);
  // A contextual tab that came or went changes what there is to find.
  useEffect(() => { if (lastKey.current !== key) { lastKey.current = key; setEntries(null); setIndexing(open || !!q.trim()); } }, [key]);

  // Alt+Q / Ctrl+Alt+Q: to the box (`code`, so a Korean keyboard layout works too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.shiftKey || e.code !== 'KeyQ') return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const wake = () => { setOpen(true); if (!entries && !indexing) setIndexing(true); };
  const done = useCallback((e: CommandEntry[]) => { setEntries(keepKnown(known.current, e)); setIndexing(false); }, []);

  const results = useMemo<CommandEntry[]>(() => {
    const hits = entries ? searchCommands(withMenuCommands(entries), q) : [];
    return q.trim() ? [...hits, { id: FIND_LIBRARY, label: `'${q.trim()}' 가사 · 성경 · 광고에서 검색`, tab: '검색' }] : [];
  }, [entries, q]);
  useEffect(() => setAt(0), [q]);

  const run = (e: CommandEntry) => {
    setOpen(false);
    setQ('');
    input.current?.blur();
    if (e.id === FIND_LIBRARY) return ed.cmd.open('find');
    go(e.tab);
    // The tab draws on the next frames; then its button is pressed (a drop-down command opens its menu).
    let tries = 0;
    const unavailable = () => ed.cmd.notify(`'${e.label}'은(는) 지금 사용할 수 없습니다 — 먼저 개체나 글을 선택하세요`);
    const press = () => {
      const body = document.querySelector('.ribbon .rb-body');
      // A command inside a drop-down: its menu is opened and the item chosen (a picture bullet opens the file picker).
      const b = body && (e.via ? findOpener(body, e) : findButton(body, e));
      if (!b) return ++tries < 8 ? void requestAnimationFrame(press) : e.via ? unavailable() : undefined;
      if (b.hasAttribute('disabled')) return unavailable();
      b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      b.click();
      if (!e.via) return;
      const menu = body.querySelector(MENU);
      const item = menu && findMenuItem(menu, e);
      if (!item || item.hasAttribute('disabled')) { if (menu) b.click(); return unavailable(); }
      item.click();
      // A menu the item left open is closed again (the arrow toggles).
      setTimeout(() => { if (body.querySelector(MENU)) b.click(); }, 80);
    };
    requestAnimationFrame(press);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (results.length) setAt((i) => (i + (ev.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
    } else if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      if (results[at]) run(results[at]);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      if (q) setQ(''); else { setOpen(false); input.current?.blur(); }
    }
  };

  const listId = 'tellme-list';
  return (
    <div className="pp-tellme">
      <span className="pp-tellme-icon" aria-hidden>💡</span>
      <input
        ref={input} type="search" className="pp-tellme-input" value={q} placeholder="어떤 작업을 원하시나요?"
        title="어떤 작업을 원하시나요? (Alt+Q)" aria-label="어떤 작업을 원하시나요?" aria-keyshortcuts="Alt+Q Control+Alt+Q"
        role="combobox" aria-expanded={open && !!q.trim()} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={results[at] ? `tellme-${at}` : undefined}
        onFocus={wake} onChange={(e) => { setQ(e.target.value); wake(); }} onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && q.trim() && (
        <ul id={listId} className="pp-tellme-list" role="listbox">
          {!entries && <li className="pp-tellme-note" role="presentation">명령을 찾는 중…</li>}
          {entries && results.length === 1 && <li className="pp-tellme-note" role="presentation">일치하는 명령이 없습니다</li>}
          {results.map((r, i) => (
            <li key={r.id} id={`tellme-${i}`} role="option" aria-selected={i === at} aria-disabled={r.disabled || undefined}
              className={`pp-tellme-item ${i === at ? 'on' : ''} ${r.disabled ? 'off' : ''}`}
              onMouseDown={(ev) => { ev.preventDefault(); run(r); }} onMouseEnter={() => setAt(i)}>
              <span className="pp-tellme-label">{r.label}</span>
              {r.id !== FIND_LIBRARY && <span className="pp-tellme-where">{r.tab}{r.group ? ` › ${r.group}` : ''}{r.via ? ` › ${r.via}` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
      {indexing && <Indexer key={key} tabs={tabs} ed={ed} actions={actions} ctx={ctx} onDone={done} />}
    </div>
  );
}
