import { useEffect, useState } from 'react';
import { formatStoragePercent } from '../../domain/cloudStorage';
import type { Ed } from './editor';
import { HomeTab, InsertTab, DrawTab } from './tabsMain';
import { DesignTab, TransitionsTab, AnimationsTab } from './tabsShow';
import { SlideShowTab, ReviewTab, ViewTab, WorshipTab, ToolsTab } from './tabsMore';
import { TellMe } from './TellMe';
import { QuickAccess, RibbonContextMenu, pressRibbonItem, ribbonItemAt, useQat } from './Qat';
import type { QatCommand, QatItem } from '../../domain/qat';
import { CONTEXT_LABEL, ContextTabBody, contextTabs, type ContextTab } from './tabsContext';

const TABS = ['홈', '삽입', '그리기', '디자인', '전환', '애니메이션', '슬라이드 쇼', '검토', '보기', '예배', '도구'] as const;
type Tab = (typeof TABS)[number] | ContextTab;

export interface RibbonActions {
  onBackstage: (page?: import('./views').BackstagePage) => void;
  onFind: () => void;
  onReplace: () => void;
  onLink: () => void;
  onComment: () => void;
  onPreview: (what: 'transition' | 'animation') => void;
  onOutline: () => void;
  onReading: () => void;
}

/** PowerPoint's title bar, quick access toolbar and ribbon (tabs and contextual tabs). */
export function Ribbon({ ed, actions }: { ed: Ed; actions: RibbonActions }) {
  const { cmd, state, dispatch, p } = ed;
  const [tab, setTab] = useState<Tab>('홈');
  const [collapsed, setCollapsed] = useState(false);
  const [peek, setPeek] = useState(false);
  const ctx = contextTabs(ed);
  // A master view's tab (슬라이드 마스터 …) sits left of 홈 and is picked when the view opens.
  const masterTab = ctx.find((t) => t === 'slideMaster' || t === 'handoutMaster' || t === 'notesMaster');
  const objTabs = ctx.filter((t) => t !== masterTab);
  useEffect(() => { if (masterTab) setTab(masterTab); }, [masterTab]);
  // A contextual tab goes when its object is no longer selected.
  useEffect(() => { if (!(TABS as readonly string[]).includes(tab) && !ctx.includes(tab as ContextTab)) setTab('홈'); }, [ctx.join(), tab]);
  const pick = (t: Tab) => { if (collapsed) setPeek(t !== tab || !peek); setTab(t); };
  const busy = cmd.service.busy;
  const title = p ? `${p.title} - LightCast` : 'LightCast';
  const showBody = !collapsed || peek;
  const [qat, setQat] = useQat();
  const [rbMenu, setRbMenu] = useState<null | { x: number; y: number; item: Extract<QatItem, { kind: 'ribbon' }> }>(null);
  const runQat = (id: QatCommand) => {
    switch (id) {
      case 'home': return actions.onBackstage('home');
      case 'new': return cmd.open('new');
      case 'open': return actions.onBackstage('open');
      case 'save': return cmd.exportPlaylistPptx();
      case 'print': return actions.onBackstage('print');
      case 'undo': return dispatch({ type: 'undo' });
      case 'redo': return dispatch({ type: 'redo' });
      case 'fromStart': return cmd.startShow(false);
      case 'find': return actions.onFind();
      case 'spelling': return ed.setPane(ed.pane === 'spelling' ? null : 'spelling');
      case 'export': return actions.onBackstage('export');
    }
  };
  const qatEnabled = (id: QatCommand) => (id === 'undo' ? !!state.past.length : id === 'redo' ? !!state.future.length : id === 'fromStart' || id === 'save' ? !!p : true);
  return (
    <div className="ribbon pp" onMouseLeave={() => collapsed && setPeek(false)}>
      <div className="pp-title">
        <div className="pp-qat">
          <img className="pp-logo" src="/favicon.png" alt="" />
          <span className="pp-autosave" title="바꾸는 즉시 저장됩니다">자동 저장 <b className="on">켬</b></span>
          <QuickAccess items={qat} setItems={setQat} run={runQat} enabled={qatEnabled}
            press={(item) => { setTab(item.tab as Tab); if (collapsed) setPeek(true); pressRibbonItem(item, () => cmd.notify(`'${item.label}'은(는) 지금 사용할 수 없습니다 — 먼저 개체나 글을 선택하세요`)); }} />
        </div>
        <div className="pp-name" title={title}>{title}</div>
        <button type="button" className="pp-search" title="검색 — 가사 · 성경 · 광고 (Ctrl+K)" onClick={() => cmd.open('find')}>🔍 검색</button>
        <span className="pp-spacer" />
        {busy && <span className="rb-busy" role="status">{busy}</span>}
        <button type="button" className="pp-pill" onClick={() => cmd.open('remoteControl')} title="휴대폰 리모컨 · 조작권 관리">
          <span className={`dot ${cmd.relayConnected ? 'ok' : ''}`} /> {cmd.relayConnected ? `휴대폰 ${cmd.remoteCount}` : '재연결 중…'}{cmd.remoteRequests > 0 && <strong className="remote-request-badge"> · 요청 {cmd.remoteRequests}</strong>}
        </button>
        <button type="button" className="pp-pill" onClick={() => cmd.open('account')} title={cmd.cloud.session ? `동기화 상태 · 계정${cmd.cloud.message ? ` — ${cmd.cloud.message}` : ''}` : '로그인하면 다른 컴퓨터에서도 같은 슬라이드를 엽니다'}>
          {cmd.cloud.session ? `☁ ${cmd.cloud.session.username}${cmd.cloud.state === 'syncing' ? ' ⟳' : cmd.cloud.state === 'error' ? ' ⚠' : cmd.cloud.state === 'offline' ? ' ⏸' : ' ✓'}` : '☁ 로그인'}{cmd.cloud.session && cmd.cloud.storageUsage?.server ? <span title="교회 서버 저장 사용률 (무료 한도 5 GB 대비) — 계정 창에서 파일·자료를 정리할 수 있습니다"> · {formatStoragePercent(cmd.cloud.storageUsage.server.usedPercent)}%</span> : null}
        </button>
        <button type="button" className="pp-pill pp-gear" onClick={() => cmd.open('settings')} title="옵션 — 업데이트 · 출력 화면 · 리모컨 · AI · 장비" aria-label="옵션">⚙</button>
      </div>
      <div className="pp-tabs" role="tablist">
        <button type="button" className="pp-tab file" onClick={() => actions.onBackstage()}>파일</button>
        {masterTab && <button type="button" role="tab" aria-selected={tab === masterTab} className={`pp-tab master ${tab === masterTab ? 'on' : ''}`} onClick={() => pick(masterTab)}>{CONTEXT_LABEL[masterTab]}</button>}
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pp-tab ${tab === t ? 'on' : ''} ${t === '예배' || t === '도구' ? 'addin' : ''}`} onClick={() => pick(t)} onDoubleClick={() => { setCollapsed(!collapsed); setPeek(false); }}>{t}</button>
        ))}
        {objTabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pp-tab ctx ${tab === t ? 'on' : ''}`} onClick={() => pick(t)}>{CONTEXT_LABEL[t]}</button>
        ))}
        <TellMe ed={ed} actions={actions} tabs={[...TABS, ...ctx]} ctx={ctx} go={(t) => { setTab(t as Tab); if (collapsed) setPeek(true); }} />
        <span className="pp-spacer" />
        <button type="button" className={`pp-comments ${ed.pane === 'comments' ? 'on' : ''}`} onClick={() => ed.setPane(ed.pane === 'comments' ? null : 'comments')}>💬 메모</button>
        <button type="button" className="pp-present" disabled={!p} title="현재 슬라이드부터 (Shift+F5) — 처음부터는 F5" onClick={() => cmd.startShow(true)}>▶ 슬라이드 쇼</button>
        <button type="button" className="pp-collapse" title={collapsed ? '리본 고정' : '리본 축소 (탭을 두 번 클릭)'} onClick={() => { setCollapsed(!collapsed); setPeek(false); }}>{collapsed ? '⌄' : '⌃'}</button>
      </div>
      {showBody && (
        <div className={`rb-body ${collapsed ? 'floating' : ''}`} onContextMenu={(e) => {
          const item = ribbonItemAt(e.target, tab);
          if (!item) return;
          e.preventDefault();
          setRbMenu({ x: e.clientX, y: e.clientY, item });
        }}>
          {tab === '홈' && <HomeTab ed={ed} onFind={actions.onFind} onReplace={actions.onReplace} />}
          {tab === '삽입' && <InsertTab ed={ed} onLink={actions.onLink} onComment={actions.onComment} />}
          {tab === '그리기' && <DrawTab ed={ed} />}
          {tab === '디자인' && <DesignTab ed={ed} />}
          {tab === '전환' && <TransitionsTab ed={ed} onPreview={() => actions.onPreview('transition')} />}
          {tab === '애니메이션' && <AnimationsTab ed={ed} onPreview={() => actions.onPreview('animation')} />}
          {tab === '슬라이드 쇼' && <SlideShowTab ed={ed} />}
          {tab === '검토' && <ReviewTab ed={ed} onComment={actions.onComment} />}
          {tab === '보기' && <ViewTab ed={ed} onOutline={actions.onOutline} onReading={actions.onReading} />}
          {tab === '예배' && <WorshipTab ed={ed} />}
          {tab === '도구' && <ToolsTab ed={ed} />}
          {ctx.includes(tab as ContextTab) && <ContextTabBody tab={tab as ContextTab} ed={ed} />}
        </div>
      )}
      {rbMenu && <RibbonContextMenu at={rbMenu} item={rbMenu.item} items={qat} setItems={setQat} onClose={() => setRbMenu(null)} />}
    </div>
  );
}

export type { Tab as RibbonTab };
