// Insert › Photo Album / Edit Photo Album (DeckCraft dialogs/photo_album.rs): the picture list with text
// boxes between pictures, a layout (fit to slide, 1 / 2 / 4 pictures, with or without a title), a frame,
// captions, black & white for all pictures, and per-picture rotation, brightness and contrast.
import { useRef, useState } from 'react';
import type { Slide } from '../../domain/types';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import {
  ALBUM_MAX_ITEMS, ALBUM_MAX_TEXT, albumAdjust, albumSlides, clampUnit, isAlbumText, needsAdjust, readAlbum, replaceAlbum, rotateBy,
  type AlbumItem, type AlbumOptions, type AlbumPicture,
} from '../../domain/photoAlbum';
import { Check, Dialog, Field } from './dialogs';
import type { Ed } from './editor';
import { adjustPicture } from './pictureTools';

const FRAMES: [string, string][] = [['', '없음'], ['rect', '사각형'], ['rounded', '둥근 사각형'], ['simpleFrame', '단순형 프레임, 흰색'], ['softEdge', '부드러운 가장자리 사각형'], ['shadowRect', '그림자 사각형']];
type Layout = 'fit' | '1' | '2' | '4';

async function pixelSize(file: Blob): Promise<{ w: number; h: number } | null> {
  try { const b = await createImageBitmap(file); const s = { w: b.width, h: b.height }; b.close(); return s; } catch { return null; }
}

const pct = (n: number | undefined) => `${Math.round((n ?? 0) * 100)}%`;

export function PhotoAlbumDialog({ ed, onClose, edit, onInsert }: { ed: Ed; onClose: () => void; edit?: boolean; onInsert: (slides: Slide[]) => void }) {
  // Edit Photo Album: the album of the current slide (or the presentation's first album).
  const albumId = edit ? (ed.slide?.album?.id ?? ed.p?.slides.find((x) => x.album)?.album?.id) : undefined;
  const existing = albumId && ed.p ? readAlbum(ed.p.slides, albumId) : null;
  const [items, setItems] = useState<AlbumItem[]>(existing?.items ?? []);
  const [layout, setLayout] = useState<Layout>(existing ? (existing.options.fit ? 'fit' : (String(existing.options.per) as Layout)) : '1');
  const [titles, setTitles] = useState(existing?.options.titles ?? false);
  const [captions, setCaptions] = useState(existing?.options.captions ?? false);
  const [frame, setFrame] = useState<string>(existing?.options.frame ?? '');
  const [gray, setGray] = useState(!!existing?.options.gray);
  const [boxText, setBoxText] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (edit && !existing) return <Dialog title="사진 앨범 편집" onClose={onClose}><p>이 프레젠테이션에 사진 앨범이 없습니다. 삽입 › 사진 앨범으로 먼저 만드세요.</p></Dialog>;
  const full = items.length >= ALBUM_MAX_ITEMS;
  const sel = at != null ? items[at] : undefined;
  const pic = sel && !isAlbumText(sel) ? sel : undefined;
  const addFiles = async (files: File[]) => {
    const added: AlbumPicture[] = [];
    for (const f of files.slice(0, ALBUM_MAX_ITEMS - items.length)) {
      const id = uid('m');
      await putMedia(id, f);
      ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'image' } });
      added.push({ mediaId: id, name: f.name, ...(await pixelSize(f)) });
    }
    setItems((cur) => [...cur, ...added]);
  };
  const addText = () => {
    const t = boxText.trim();
    if (!t || full) return;
    // A text box goes after the selected item (PowerPoint: between pictures), else at the end.
    const next = [...items];
    next.splice(at == null ? next.length : at + 1, 0, { text: t.slice(0, ALBUM_MAX_TEXT) });
    setItems(next);
    setBoxText('');
  };
  const patch = (p: Partial<AlbumPicture>) => { if (at != null && pic) setItems(items.map((x, i) => (i === at ? { ...pic, ...p } : x))); };
  const move = (d: -1 | 1) => {
    if (at == null) return;
    const j = at + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[at], next[j]] = [next[j], next[at]];
    setItems(next);
    setAt(j);
  };
  const options = (): AlbumOptions => ({ per: layout === 'fit' ? 1 : (Number(layout) as 1 | 2 | 4), fit: layout === 'fit' || undefined, titles: layout !== 'fit' && titles, frame, captions, gray: gray || undefined });
  const ok = async () => {
    if (!items.length || !ed.p) return;
    const o = options();
    setBusy(true);
    try {
      // Black & white, brightness and contrast go through the engine's picture pipeline, one new picture each.
      const built: AlbumItem[] = [];
      for (const it of items) {
        if (isAlbumText(it) || !needsAdjust(it, o)) { built.push(isAlbumText(it) ? it : { ...it, shown: undefined }); continue; }
        const r = await adjustPicture({ id: 'album', kind: 'image', mediaId: it.mediaId, x: 0, y: 0, w: 1, h: 1 }, albumAdjust(it, o), ed.dispatch);
        built.push(r?.mediaId && r.picture ? { ...it, shown: { mediaId: r.mediaId, picture: r.picture } } : it);
      }
      if (existing && albumId) ed.updatePres({ slides: replaceAlbum(ed.p.slides, albumId, built, o) });
      else onInsert(albumSlides(built, o, ed.slide?.group ?? '사진 앨범'));
      onClose();
    } finally { setBusy(false); }
  };
  const label = (it: AlbumItem, i: number) => (isAlbumText(it) ? `${i + 1}. ▭ ${it.text.slice(0, 40)}` : `${i + 1}. ${it.name}`);
  const status = !sel ? '그림을 골라 회전하거나 밝기와 대비를 바꿉니다' : isAlbumText(sel) ? '텍스트 상자에는 그림 옵션이 없습니다' : `회전 ${Math.round(sel.rot ?? 0)}°, 밝기 ${pct(sel.brightness)}, 대비 ${pct(sel.contrast)}`;
  return (
    <Dialog title={existing ? '사진 앨범 편집' : '사진 앨범'} onClose={onClose} onOk={() => void ok()} okLabel={busy ? '만드는 중…' : existing ? '업데이트' : '만들기'} okDisabled={!items.length || !ed.canEdit || busy} wide>
      <div className="dlg-row"><button type="button" disabled={full} onClick={() => input.current?.click()}>파일/디스크…</button><span>{items.length ? `${items.length} / ${ALBUM_MAX_ITEMS}개 (그림 · 텍스트 상자)` : '앨범에 넣을 그림을 고르세요'}</span></div>
      <div className="dlg-list">{items.map((f, i) => <button key={`${isAlbumText(f) ? 't' : f.mediaId}-${i}`} type="button" className={at === i ? 'on' : ''} onClick={() => setAt(i)}>{label(f, i)}</button>)}</div>
      <div className="dlg-row">
        <button type="button" disabled={at == null || at === 0} onClick={() => move(-1)} aria-label="위로">▲</button>
        <button type="button" disabled={at == null || at === items.length - 1} onClick={() => move(1)} aria-label="아래로">▼</button>
        <button type="button" disabled={at == null} onClick={() => { if (at == null) return; setItems(items.filter((_, j) => j !== at)); setAt(null); }}>제거</button>
      </div>
      <div className="dlg-row album-box">
        <input value={boxText} maxLength={ALBUM_MAX_TEXT} placeholder="텍스트 상자 내용" aria-label="텍스트 상자 내용" onChange={(e) => setBoxText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addText(); } }} />
        <button type="button" disabled={!boxText.trim() || full} onClick={addText}>새 텍스트 상자</button>
      </div>
      <fieldset className="dlg-set" disabled={!pic}>
        <legend>선택한 그림</legend>
        <div className="dlg-row album-pic">
          <button type="button" onClick={() => patch({ rot: rotateBy(pic?.rot, -90) })}>⟲ 왼쪽으로 회전</button>
          <button type="button" onClick={() => patch({ rot: rotateBy(pic?.rot, 90) })}>⟳ 오른쪽으로 회전</button>
          <button type="button" onClick={() => patch({ brightness: clampUnit((pic?.brightness ?? 0) + 0.1) })}>☀＋ 밝게</button>
          <button type="button" onClick={() => patch({ brightness: clampUnit((pic?.brightness ?? 0) - 0.1) })}>☀－ 어둡게</button>
          <button type="button" onClick={() => patch({ contrast: clampUnit((pic?.contrast ?? 0) + 0.1) })}>◐＋ 대비 높게</button>
          <button type="button" onClick={() => patch({ contrast: clampUnit((pic?.contrast ?? 0) - 0.1) })}>◐－ 대비 낮게</button>
        </div>
        <small className="album-status" role="status">{status}</small>
      </fieldset>
      <div className="dlg-grid3">
        <Field label="그림 레이아웃"><select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}><option value="fit">슬라이드에 맞춤</option><option value="1">그림 1개</option><option value="2">그림 2개</option><option value="4">그림 4개</option></select></Field>
        <Field label="프레임 모양"><select value={frame} onChange={(e) => setFrame(e.target.value)}>{FRAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
      <Check label="제목 포함" checked={layout !== 'fit' && titles} onChange={setTitles} />
      <Check label="모든 그림 아래에 캡션 넣기" checked={captions} onChange={setCaptions} />
      <Check label="모든 그림을 흑백으로" checked={gray} onChange={setGray} />
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </Dialog>
  );
}
