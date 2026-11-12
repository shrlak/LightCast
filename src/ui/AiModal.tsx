import { useEffect, useState } from 'react';
import type { Presentation } from '../domain/types';
import { ai, type AiSlides } from '../domain/ai';
import { uid } from '../domain/lyrics';
import { AutoTextarea } from './AutoTextarea';

interface Props {
  onClose: () => void;
  onCreate: (p: Presentation) => void;
}

const EXAMPLES = [
  '이번 주 광고: 다음 주 야외예배 (공원, 11시), 성경공부 신청 마감 금요일 — 광고 슬라이드로 만들어줘',
  'Make 4 slides introducing our church picnic on June 7 at Riverside Park, 1–4pm, bring a side dish',
  'Turn this sermon outline into slides: 1. 은혜란 무엇인가 2. 은혜를 받은 자의 삶 3. 은혜를 나누는 공동체',
  'Welcome slides for first-time visitors in Korean and English',
];

/** AI assistant: describe what you need (or paste text) and get a ready presentation. */
export function AiModal({ onClose, onCreate }: Props) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiSlides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ model: string; configured: boolean } | null | undefined>(undefined);

  useEffect(() => {
    ai.status().then(setStatus);
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await ai.assist(prompt));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    if (!result) return;
    onCreate({
      id: uid('p'),
      title: result.title || 'AI slides',
      folder: 'AI',
      themeId: result.slides.some((s) => s.title) ? 'theme_info' : 'theme_classic',
      slides: result.slides.map((s) => ({ id: uid('s'), group: s.group, text: s.text, title: s.title || undefined, subtext: s.subtext || undefined })),
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="AI assistant">
        <header className="modal-head">
          <h2>✨ AI assistant</h2>
          <span className="muted small">{status === null ? 'Server offline — run npm run dev / npm start' : status ? `Gemini · OpenRouter (${status.model} 외)` : ''}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="editor-body">
          <div className="editor-col">
            <AutoTextarea className="lyrics-input" style={{ minHeight: '34vh' }} placeholder="Describe the slides you need, or paste text to turn into slides…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="stack">
              {EXAMPLES.map((ex) => <button key={ex} className="example" onClick={() => setPrompt(ex)}>{ex}</button>)}
            </div>
            <p className="hint">Also in LightCast: ✨ Translate on any presentation (adds English lines), and AI reading of 콘티 PDFs and 카톡 공지 in the 주일예배 builder.</p>
            {error && <div className="warn">{error}</div>}
          </div>
          <div className="editor-col preview-col">
            <strong>{result ? `${result.title} · ${result.slides.length} slides` : 'Preview'}</strong>
            <ol className="preview-list">
              {result?.slides.map((s, i) => (
                <li key={i}>
                  <span className="muted small">{s.group}{s.title ? ` · ${s.title}` : ''}</span>
                  <div className="pre">{s.text}</div>
                  {s.subtext && <div className="pre muted small">{s.subtext}</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
        <footer className="modal-foot">
          <button onClick={onClose}>Close</button>
          <button disabled={!prompt.trim() || busy} onClick={run}>{busy ? 'Thinking…' : result ? 'Regenerate' : 'Generate'}</button>
          <button className="primary" disabled={!result} onClick={create}>Add to library</button>
        </footer>
      </div>
    </div>
  );
}
