import { useEffect, useState } from 'react';
import { formatStoragePercent } from '../../domain/cloudStorage';
import type { Ed } from './editor';
import { HomeTab, InsertTab, DrawTab } from './tabsMain';
import { DesignTab, TransitionsTab, AnimationsTab } from './tabsShow';
import { SlideShowTab, ReviewTab, ViewTab, WorshipTab, ToolsTab } from './tabsMore';
import { TellMe } from './TellMe';
import { CONTEXT_LABEL, ContextTabBody, contextTabs, type ContextTab } from './tabsContext';

const TABS = ['홈', '삽입', '그리기', '디자인', '전환', '애니메이션', '슬라이드 쇼', '검토', '보기', '예배', '도구'] as const;
type Tab = (typeof TABS)[number] | ContextTab;

export interface RibbonActions {
  onBackstage: () => void;
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
  // A contextual tab goes when its object is no longer selected.
  useEffect(() => { if (!(TABS as readonly string[]).includes(tab) && !ctx.includes(tab as ContextTab)) setTab('홈'); }, [ctx.join(), tab]);
  const pick = (t: Tab) => { if (collapsed) setPeek(t !== tab || !peek); setTab(t); };
  const busy = cmd.service.busy;
  const title = p ? `${p.title} - LightCast` : 'LightCast';
  const showBody = !collapsed || peek;
  return (
    <div className="ribbon pp" onMouseLeave={() => collapsed && setPeek(false)}>
      <div className="pp-title">
        <div className="pp-qat">
          <img className="pp-logo" src="/favicon.png" alt="" />
          <span className="pp-autosave" title="바꾸는 즉시 저장됩니다">자동 저장 <b className="on">켬</b></span>
          <button type="button" title="저장 — PowerPoint 파일로 (재생목록)" onClick={cmd.exportPlaylistPptx}>💾</button>
          <button type="button" title="실행 취소 (Ctrl+Z)" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })}>↶</button>
          <button type="button" title="다시 실행 (Ctrl+Y)" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })}>↷</button>
          <button type="button" title="처음부터 시작 (F5)" disabled={!p} onClick={() => cmd.startShow(false)}>▣</button>
        </div>
        <div className="pp-name" title={title}>{title}</div>
        <button type="button" className="pp-search" title="검색 — 가사 · 성경 · 광고 (Ctrl+K)" onClick={() => cmd.open('find')}>🔍 검색</button>
        <span className="pp-spacer" />
        {busy && <span className="rb-busy" role="status">{busy}</span>}
        <button type="button" className="pp-pill" onClick={() => cmd.open('remoteControl')} title="휴대폰 리모컨 · 조작권 관리">
          <span className={`dot ${cmd.relayConnected ? 'ok' : ''}`} /> {cmd.relayConnected ? `휴대폰 ${cmd.remoteCount}` : '재연결 중…'}{cmd.remoteRequests > 0 && <strong className="remote-request-badge"> · 요청 {cmd.remoteRequests}</strong>}
        </button>
        <button type="button" className="pp-pill" onClick={() => cmd.open(cmd.cloud.session ? 'sync' : 'account')} title={cmd.cloud.session ? `동기화 상태 · 계정${cmd.cloud.message ? ` — ${cmd.cloud.message}` : ''}` : '로그인하면 다른 컴퓨터에서도 같은 슬라이드를 엽니다'}>
          {cmd.cloud.session ? `☁ ${cmd.cloud.session.username}${cmd.cloud.state === 'syncing' ? ' ⟳' : cmd.cloud.state === 'error' ? ' ⚠' : cmd.cloud.state === 'offline' ? ' ⏸' : ' ✓'}` : '☁ 로그인'}{cmd.cloud.session && cmd.cloud.storageUsage?.server ? ` · ${formatStoragePercent(cmd.cloud.storageUsage.server.usedPercent)}%` : ''}
        </button>
        <button type="button" className="pp-pill pp-gear" onClick={() => cmd.open('settings')} title="옵션 — 업데이트 · 출력 화면 · 리모컨 · AI · 장비" aria-label="옵션">⚙</button>
      </div>
      <div className="pp-tabs" role="tablist">
        <button type="button" className="pp-tab file" onClick={actions.onBackstage}>파일</button>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pp-tab ${tab === t ? 'on' : ''} ${t === '예배' || t === '도구' ? 'addin' : ''}`} onClick={() => pick(t)} onDoubleClick={() => { setCollapsed(!collapsed); setPeek(false); }}>{t}</button>
        ))}
        {ctx.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pp-tab ctx ${tab === t ? 'on' : ''}`} onClick={() => pick(t)}>{CONTEXT_LABEL[t]}</button>
        ))}
        <TellMe ed={ed} actions={actions} tabs={[...TABS, ...ctx]} ctx={ctx} go={(t) => { setTab(t as Tab); if (collapsed) setPeek(true); }} />
        <span className="pp-spacer" />
        <button type="button" className={`pp-comments ${ed.pane === 'comments' ? 'on' : ''}`} onClick={() => ed.setPane(ed.pane === 'comments' ? null : 'comments')}>💬 메모</button>
        <button type="button" className="pp-present" disabled={!p} title="현재 슬라이드부터 (Shift+F5) — 처음부터는 F5" onClick={() => cmd.startShow(true)}>▶ 슬라이드 쇼</button>
        <button type="button" className="pp-collapse" title={collapsed ? '리본 고정' : '리본 축소 (탭을 두 번 클릭)'} onClick={() => { setCollapsed(!collapsed); setPeek(false); }}>{collapsed ? '⌄' : '⌃'}</button>
      </div>
      {showBody && (
        <div className={`rb-body ${collapsed ? 'floating' : ''}`}>
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
    </div>
  );
}

export type { Tab as RibbonTab };
