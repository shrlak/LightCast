import { useRef, useState } from 'react';
import type { Presentation } from '../../domain/types';
import { findSong, parseLyricsMarkdown, type SongDraft, type SongSection } from '../../domain/sunday/songs';
import { parseNotice, type ParsedNotice } from '../../domain/sunday/notice';
import { readConti as readContiPdf } from '../../domain/recognition/conti';
import { ai } from '../../domain/ai';
import { AutoTextarea } from '../AutoTextarea';

export function sectionsToText(sections: SongSection[]): string {
  return sections.map((s) => `[${s.label}]\n${s.lines.join('\n')}`).join('\n\n');
}

export function textToSections(text: string): SongSection[] {
  const out: SongSection[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const h = /^\[(.+)\]$/.exec(line);
    if (h) out.push({ label: h[1].trim(), lines: [] });
    else if (line) {
      if (!out.length) out.push({ label: 'V', lines: [] });
      out[out.length - 1].lines.push(line);
    }
  }
  return out;
}

export interface CoverInfo {
  date?: ParsedNotice['date'];
  scripture?: string;
  sermonTitle?: string;
  preacher?: string;
  confession?: string;
}

interface Props {
  songs: SongDraft[];
  setSongs: (s: SongDraft[]) => void;
  notice: string;
  setNotice: (s: string) => void;
  library: Presentation[];
  linesPerSlide: number;
  /** This week's 공동체 고백송, set apart from the 찬양 when reading a 콘티. */
  confessionSong?: string;
  setLinesPerSlide: (n: number) => void;
  onCover: (info: CoverInfo) => void;
  notify: (msg: string) => void;
}

function linkLibrary(song: SongDraft, library: Presentation[]): SongDraft {
  const match = findSong(library, song.title);
  return match && !song.sections.length ? { ...song, presentationId: match.id } : song;
}

export function SundaySongs({ songs, setSongs, notice, setNotice, library, linesPerSlide, confessionSong, setLinesPerSlide, onCover, notify }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const mdRef = useRef<HTMLInputElement>(null);
  const update = (i: number, patch: Partial<SongDraft>) => setSongs(songs.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= songs.length) return;
    const next = [...songs];
    [next[i], next[j]] = [next[j], next[i]];
    setSongs(next);
  };

  const applyNotice = () => {
    const n = parseNotice(notice);
    if (!n.songs.length) {
      notify('No song list found in the notice (looks for “🎶찬양곡:” followed by numbered songs).');
    } else {
      // Keep lyrics already read from a 콘티 when the same song is in the notice; follow the notice's order, names and keys.
      const next = n.songs.map((ns) => {
        const prev = songs.find((s) => findSong([{ id: 'x', title: s.title, slides: [], themeId: '' }], ns.title));
        return linkLibrary({ ...(prev ?? { sections: [] }), title: ns.title, key: ns.key ?? prev?.key }, library);
      });
      setSongs(next);
      notify(`Notice applied: ${next.length} songs, ${next.filter((s) => s.presentationId).length} found in the library.`);
    }
    onCover({ date: n.date, scripture: n.scripture, sermonTitle: n.sermonTitle, preacher: n.preacher, confession: n.confession });
  };

  const aiNotice = async () => {
    setBusy('Reading the notice with AI…');
    try {
      const r = await ai.notice(notice);
      setSongs(r.songs.map((s) => linkLibrary({ title: s.title, key: s.key || undefined, sections: [] }, library)));
      const [y, m, d] = r.date.split('-').map(Number);
      onCover({ date: m ? { year: y, month: m, day: d } : undefined, scripture: r.scripture, sermonTitle: r.sermonTitle, preacher: r.preacher, confession: r.confession });
      notify(`AI read ${r.songs.length} songs${r.prayerTopics.length ? `, ${r.prayerTopics.length} prayer topics` : ''}${r.announcements.length ? `, ${r.announcements.length} announcements` : ''}.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const readConti = async (file: File | undefined) => {
    if (!file) return;
    setBusy('콘티 읽는 중…');
    try {
      // The ppt site's recognition (domain/recognition): library first, the AI models for the rest.
      const notes: string[] = [];
      const r = await readContiPdf(file, { presentations: library, linesPerSlide, confessionSong: confessionSong ?? '', notify: (m) => notes.push(m), progress: setBusy });
      setSongs(r.songs.map((s) => s.draft));
      onCover({ date: r.date, scripture: r.scripture, sermonTitle: r.sermonTitle });
      const unread = r.songs.filter((s) => s.needsReview).length;
      notify(`콘티 read: ${r.songs.length} songs${unread ? ` (${unread} to check against the 악보)` : ''}.${notes.length ? ` ${notes.join(' ')}` : ''}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
      if (pdfRef.current) pdfRef.current.value = '';
    }
  };

  const importMd = async (files: FileList | null) => {
    const added: SongDraft[] = [];
    for (const f of Array.from(files ?? [])) added.push(parseLyricsMarkdown(await f.text(), f.name.replace(/\.(md|txt)$/i, '')));
    setSongs([...songs, ...added]);
    if (mdRef.current) mdRef.current.value = '';
  };

  return (
    <div className="stack">
      <div className="two-col">
        <div className="card stack">
          <h3>콘티 PDF</h3>
          <p className="hint">AI가 표지(날짜, 본문, 설교 제목)와 곡마다 악보의 제목 · 키 · 진행(I-V1-C-V2-C-B-C) · 가사를 읽습니다.</p>
          <button className="primary" disabled={!!busy} onClick={() => pdfRef.current?.click()}>콘티 PDF 올리기</button>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => readConti(e.target.files?.[0])} />
        </div>
        <div className="card stack">
          <h3>카톡 공지 (선택)</h3>
          <AutoTextarea rows={6} placeholder={'🎶찬양곡:\n1️⃣ 주님의 은혜 넘치네 (G)\n2️⃣ …\n📖 본문: 로마서 5장 1-11절\n🤝공동체 고백: …'} value={notice} onChange={(e) => setNotice(e.target.value)} />
          <div className="row gap-xs">
            <button disabled={!notice.trim()} onClick={applyNotice}>공지대로 순서·이름 확정</button>
            <button disabled={!notice.trim() || !!busy} onClick={aiNotice}>✨ AI로 읽기</button>
          </div>
        </div>
      </div>
      {busy && <div className="card busy">⏳ {busy}</div>}

      <div className="row gap-s wrap">
        <strong>찬양 {songs.length}곡</strong>
        <label className="field-inline">슬라이드당 줄 수
          <select value={linesPerSlide} onChange={(e) => setLinesPerSlide(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <button onClick={() => setSongs([...songs, { title: '새 찬양', sections: [] }])}>＋ 찬양</button>
        <button onClick={() => mdRef.current?.click()} title="가사 파일: # 제목 / ## 절 (`V`) / 줄">＋ 가사 .md 파일</button>
        <input ref={mdRef} type="file" accept=".md,.txt,text/markdown,text/plain" multiple hidden onChange={(e) => importMd(e.target.files)} />
      </div>

      {songs.map((song, i) => {
        const linked = song.presentationId ? library.find((p) => p.id === song.presentationId) : undefined;
        const match = !linked ? findSong(library, song.title) : undefined;
        return (
          <div key={i} className="card song-card">
            <div className="row gap-xs wrap">
              <span className="song-num">{i + 1}</span>
              <input className="grow plain strong" value={song.title} onChange={(e) => update(i, { title: e.target.value, presentationId: undefined })} />
              <input className="key-input" placeholder="Key" value={song.key ?? ''} onChange={(e) => update(i, { key: e.target.value || undefined })} />
              <input placeholder="Progression e.g. I-V1-C-V2-C-B-C" value={song.progression?.join('-') ?? ''} onChange={(e) => update(i, { progression: e.target.value.trim() ? e.target.value.split(/\s*[-–→>~]\s*/).filter(Boolean) : undefined })} />
              <label className="check small"><input type="checkbox" checked={!!song.postSermon} onChange={(e) => update(i, { postSermon: e.target.checked || undefined })} /> 설교 후</label>
              <button className="mini-btn" onClick={() => move(i, -1)}>↑</button>
              <button className="mini-btn" onClick={() => move(i, 1)}>↓</button>
              <button className="mini-btn" onClick={() => setSongs(songs.filter((_, k) => k !== i))}>✕</button>
            </div>
            {linked ? (
              <div className="row gap-xs small">
                <span className="ok">📚 Using library lyrics: {linked.title} ({linked.slides.length} slides)</span>
                <button className="mini-btn" onClick={() => update(i, { presentationId: undefined, sections: song.sections.length ? song.sections : [] })}>여기서 가사 편집</button>
              </div>
            ) : (
              <>
                {match && <button className="small link" onClick={() => update(i, { presentationId: match.id })}>📚 “{match.title}” is in the library — use those lyrics</button>}
                <AutoTextarea rows={Math.min(14, Math.max(4, song.sections.reduce((n, s) => n + s.lines.length + 2, 0)))} spellCheck={false}
                  placeholder={'[V1]\n가사 첫 줄\n가사 둘째 줄\n\n[C]\n후렴…'}
                  defaultValue={sectionsToText(song.sections)}
                  key={`${i}-${song.title}-${song.sections.length}`}
                  onBlur={(e) => update(i, { sections: textToSections(e.target.value) })} />
              </>
            )}
            {song.pages?.length ? <span className="muted small">p.{song.pages.join(', p.')}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
