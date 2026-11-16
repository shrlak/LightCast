// Ctrl+V / Home › Paste with slides on the clipboard (copied in PowerPoint's thumbnail pane, LibreOffice's slide
// panel, or files copied in the file manager): the slides come in after the current one, in order, as one undo step.
import type { MediaMeta, Slide } from '../../domain/types';
import { filesToSlides } from '../importFiles';
import { NO_SLIDE_DATA, deckFilesOf, importClipboardDecks, logUnrecognised, readClipboard, tick, type ClipSnapshot, type ClipboardRead } from '../clipboardSlides';

export interface PasteSlidesHost {
  addMedia: (m: MediaMeta) => void;
  notify: (msg: string) => void;
  /** Put the slides after the current slide, in order, as ONE change (one undo). */
  insert: (slides: Slide[]) => void;
}
/** pasted: slides were put in (or the attempt failed and said so); none: the clipboard has no slides (carry on with shapes, pictures, text). */
export type PasteSlidesOutcome = 'pasted' | 'failed' | 'none';

/** Formats whose names say PowerPoint / LibreOffice copied slides or objects. */
const OFFICE_NAME = /powerpoint|GVML|Embed Source|Object Descriptor|Link Source|Star EMBS|openoffice|Internal Slides/i;
const SLIDES_NAME = /Internal Slides|Star EMBS|embed-source/i;

export interface PasteSlidesOptions {
  /** On the canvas: PowerPoint's shapes (GVML) win when the copied deck is only one slide. */
  preferShapes?: boolean;
  /** An explicit Paste button: the browser may be asked to read the clipboard. */
  browserRead?: boolean;
}

export async function pasteSlides(snap: ClipSnapshot | null, host: PasteSlidesHost, opts: PasteSlidesOptions = {}): Promise<{ outcome: PasteSlidesOutcome; read: ClipboardRead }> {
  const read = await readClipboard({ snapshot: snap, browserRead: opts.browserRead });
  let decks = read.decks;
  // A copied .pptx / .odp file (the file manager) pastes as its slides too, even when its bytes were not a deck.
  if (!decks.length && deckFilesOf(snap).length) {
    logUnrecognised(read, '슬라이드 파일을 읽지 못함');
    host.notify(`${deckFilesOf(snap)[0].name}: 슬라이드를 읽지 못했습니다. 파일 › 열기로 열어 보세요.`);
    return { outcome: 'failed', read };
  }
  if (decks.length && opts.preferShapes && read.gvml && decks.every((d) => d.format === 'pptx' && (d.slideCount ?? 0) < 2)) decks = [];
  if (!decks.length) {
    const origin = read.rows.some((r) => OFFICE_NAME.test(r.name));
    if (origin && !read.gvml && read.rows.some((r) => SLIDES_NAME.test(r.name) || r.cls === 'cfb' || r.cls === 'unknown' || r.cls === 'unread')) {
      // PowerPoint / LibreOffice copied something this paste cannot read: say how to get the slides in, and log the list.
      logUnrecognised(read, '슬라이드 데이터를 찾지 못함');
      host.notify(NO_SLIDE_DATA);
      return { outcome: 'failed', read };
    }
    return { outcome: 'none', read };
  }
  host.notify('붙여넣은 슬라이드 읽는 중…');
  const approx: string[] = [];
  const toSlides = (file: File) => filesToSlides([file], host.addMedia, host.notify, (n) => approx.push(n), host.notify);
  const result = await importClipboardDecks(decks, toSlides);
  if (!result.slides.length) {
    logUnrecognised(read, `슬라이드를 읽지 못함: ${result.errors.join(' / ')}`);
    host.notify(`슬라이드를 읽지 못했습니다. ${result.errors[0] ?? ''} ${NO_SLIDE_DATA}`.trim());
    return { outcome: 'failed', read };
  }
  await tick();
  host.insert(result.slides);
  host.notify(`슬라이드 ${result.slides.length}장을 붙여넣었습니다${approx.length ? ' — 일부는 단순화된 서식으로 가져왔습니다 (글자는 그대로 편집할 수 있습니다)' : ''}`);
  return { outcome: 'pasted', read };
}
