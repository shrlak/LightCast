// View › New Window / Arrange All. The Electron app opens a second editor window (same app, same library through the
// storage event, see useWindowSync); the browser opens a new tab. Arrange All tiles the app's windows on one display in
// Electron; a browser cannot place its tabs, so it only says so.
import { desktop } from '../../domain/desktop';
import { windowHash } from '../../domain/windowSync';

export const ARRANGE_BROWSER_NOTE = '브라우저에서는 창 배치를 바꿀 수 없습니다. 새 창(탭)을 운영체제의 창 정렬 기능(Windows: 창 맞춤, macOS: 화면 분할)으로 나란히 놓으세요. 데스크톱 앱에서는 이 단추가 창을 자동으로 배열합니다.';

export async function openNewWindow(presentationId: string | null | undefined, notify: (m: string) => void): Promise<void> {
  const hash = windowHash(presentationId);
  try {
    if (desktop?.newWindow) {
      if (await desktop.newWindow(hash)) return;
      notify('새 창을 열지 못했습니다.');
      return;
    }
    const w = window.open(`${window.location.origin}${window.location.pathname}${hash}`, '_blank');
    if (!w) notify('브라우저가 새 창을 막았습니다. 이 사이트의 팝업을 허용해 주세요.');
  } catch { notify('새 창을 열지 못했습니다.'); }
}

export async function arrangeAllWindows(notify: (m: string) => void): Promise<void> {
  if (!desktop?.arrangeAll) { notify(ARRANGE_BROWSER_NOTE); return; }
  try {
    const n = await desktop.arrangeAll();
    notify(n > 1 ? `창 ${n}개를 현재 화면에 나란히 배열했습니다.` : '배열할 다른 창이 없습니다. 먼저 새 창을 여세요.');
  } catch { notify('창을 배열하지 못했습니다.'); }
}
