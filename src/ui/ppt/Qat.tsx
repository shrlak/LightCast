// 빠른 실행 도구 모음 — the customizable buttons at the left of the title bar (DeckCraft's ribbon/qat.rs): the
// Customize menu's checkboxes, a right-click on any ribbon button to add it, a right-click on a toolbar button
// to remove or move it, and 기본값으로 다시 설정.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { QAT_COMMANDS, QAT_DEFAULTS, addQat, loadQat, moveQat, qatKey, qatLabel, removeQat, saveQat, sameItem, toggleQat, type QatCommand, type QatItem } from '../../domain/qat';
import { buttonLabel, findButton, groupOf } from './commandIndex';

/** The buttons a right-click in the ribbon cannot add: split arrows and dialog launchers. */
const SKIP = '.rb-launcher, .rb-caret, .rb-split-caret, .ppt-caret-btn, [data-tellme-skip]';

export function useQat(): [QatItem[], (next: QatItem[]) => void] {
  const [items, setItems] = useState<QatItem[]>(() => loadQat());
  return [items, (next) => { setItems(next); saveQat(next); }];
}

/** A small right-click menu at the pointer. */
export function PopMenu({ at, onClose, children }: { at: { x: number; y: number }; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', key); };
  }, [onClose]);
  return <div ref={ref} className="ppt-menu qat-menu" role="menu" style={{ position: 'fixed', left: at.x, top: at.y, zIndex: 1000 }}>{children}</div>;
}

const Item = ({ label, onClick, on, disabled }: { label: ReactNode; onClick: () => void; on?: boolean; disabled?: boolean }) => (
  <button type="button" role="menuitem" className={`ppt-item ${on ? 'on' : ''}`} disabled={disabled} onClick={onClick}>{on !== undefined && <span className="qat-check">{on ? '✓' : ''}</span>}{label}</button>
);

/** The toolbar's buttons and its Customize menu. `run` does a command; `press` presses a ribbon button. */
export function QuickAccess({ items, setItems, run, enabled, press }: {
  items: QatItem[];
  setItems: (next: QatItem[]) => void;
  run: (id: QatCommand) => void;
  enabled: (id: QatCommand) => boolean;
  press: (item: Extract<QatItem, { kind: 'ribbon' }>) => void;
}) {
  const [menu, setMenu] = useState<null | { x: number; y: number; item?: QatItem }>(null);
  const open = (e: ReactMouseEvent, item?: QatItem) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item }); };
  return (
    <>
      {items.map((it) => {
        const cmd = it.kind === 'command' ? QAT_COMMANDS.find((c) => c.id === it.id) : null;
        const label = qatLabel(it);
        return (
          <button key={qatKey(it)} type="button" className="qat-btn" title={it.kind === 'ribbon' ? `${label} (${it.tab}${it.group ? ` › ${it.group}` : ''})` : label} aria-label={label}
            disabled={it.kind === 'command' && !enabled(it.id)} onClick={() => (it.kind === 'command' ? run(it.id) : press(it))} onContextMenu={(e) => open(e, it)}>
            {cmd ? cmd.icon : <span className="qat-badge">{label.slice(0, 1)}</span>}
          </button>
        );
      })}
      <button type="button" className="qat-more" title="빠른 실행 도구 모음 사용자 지정" aria-label="빠른 실행 도구 모음 사용자 지정" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: r.left, y: r.bottom }); }}>⌄</button>
      {menu && (
        <PopMenu at={menu} onClose={() => setMenu(null)}>
          {menu.item ? (
            <>
              <Item label="빠른 실행 도구 모음에서 제거" onClick={() => { setItems(removeQat(items, menu.item!)); setMenu(null); }} />
              <Item label="왼쪽으로 이동" disabled={sameItem(items[0], menu.item)} onClick={() => { setItems(moveQat(items, menu.item!, -1)); setMenu(null); }} />
              <Item label="오른쪽으로 이동" disabled={sameItem(items[items.length - 1], menu.item)} onClick={() => { setItems(moveQat(items, menu.item!, 1)); setMenu(null); }} />
            </>
          ) : (
            <>
              <div className="ppt-menu-head">빠른 실행 도구 모음 사용자 지정</div>
              {QAT_COMMANDS.map((c) => <Item key={c.id} label={c.label} on={items.some((x) => x.kind === 'command' && x.id === c.id)} onClick={() => setItems(toggleQat(items, c.id))} />)}
              <div className="ppt-menu-sep" />
              <div className="ppt-item muted qat-hint">리본의 단추를 마우스 오른쪽 단추로 클릭하면 여기에 추가됩니다.</div>
              <Item label="기본값으로 다시 설정" onClick={() => { setItems(QAT_DEFAULTS); setMenu(null); }} />
            </>
          )}
        </PopMenu>
      )}
    </>
  );
}

/** The ribbon item a right-click landed on, as a toolbar item of `tab`; null on anything that is not a command button. */
export function ribbonItemAt(target: EventTarget | null, tab: string): Extract<QatItem, { kind: 'ribbon' }> | null {
  const b = (target as Element | null)?.closest?.('button');
  if (!b || b.matches(SKIP) || !b.closest('.rb-body')) return null;
  const label = buttonLabel(b as HTMLElement);
  if (!label || label.length > 40) return null;
  const group = groupOf(b);
  return { kind: 'ribbon', tab, label, ...(group ? { group } : {}) };
}

/** Presses a toolbar item's ribbon button once its tab has drawn (a few frames at most). */
export function pressRibbonItem(item: Extract<QatItem, { kind: 'ribbon' }>, unavailable: () => void) {
  let tries = 0;
  const go = () => {
    const body = document.querySelector('.ribbon .rb-body');
    const b = body && findButton(body, { id: qatKey(item), label: item.label, tab: item.tab, group: item.group });
    if (!b) return ++tries < 8 ? void requestAnimationFrame(go) : unavailable();
    if (b.hasAttribute('disabled')) return unavailable();
    b.click();
  };
  requestAnimationFrame(go);
}

/** The ribbon's right-click menu: add the button under the pointer to the toolbar (or take it off). */
export function RibbonContextMenu({ at, item, items, setItems, onClose }: { at: { x: number; y: number }; item: Extract<QatItem, { kind: 'ribbon' }>; items: QatItem[]; setItems: (next: QatItem[]) => void; onClose: () => void }) {
  const has = items.some((x) => sameItem(x, item));
  return (
    <PopMenu at={at} onClose={onClose}>
      {has
        ? <Item label="빠른 실행 도구 모음에서 제거" onClick={() => { setItems(removeQat(items, item)); onClose(); }} />
        : <Item label="빠른 실행 도구 모음에 추가" onClick={() => { setItems(addQat(items, item)); onClose(); }} />}
    </PopMenu>
  );
}
