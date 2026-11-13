import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OperatorView } from './views/OperatorView';
import { OutputView } from './views/OutputView';
import { StageView } from './views/StageView';
import { TeamView } from './views/TeamView';
import { RemoteView } from './views/RemoteView';
import { MixerView } from './views/MixerView';
import '@fontsource/nanum-gothic/400.css';
import '@fontsource/nanum-gothic/700.css';
import '@fontsource/nanum-gothic/800.css';
import '@fontsource/carlito/400.css';
import '@fontsource/carlito/700.css';
import '@fontsource/carlito/400-italic.css';
import '@fontsource/arimo/400.css';
import '@fontsource/arimo/700.css';
import '@fontsource/arimo/400-italic.css';
import './styles.css';
import { loadEngine } from './engine/load';
import { registerStoredFonts } from './domain/embeddedFonts';

const view = new URLSearchParams(location.search).get('view');
const Root = view === 'output' ? OutputView : view === 'stage' ? StageView : view === 'remote' ? RemoteView : view === 'team' ? TeamView : view === 'mixer' ? MixerView : OperatorView;
document.body.dataset.view = view ?? 'operator';
void registerStoredFonts();

// The animated KCCP start screen (public/splash.js) plays to the end — or until it is clicked —
// then fades. The desktop app already showed it in its splash window, and output/stage windows
// never show it.
const splash = document.getElementById('boot-splash');
if (splash) {
  if (view || 'freecastDesktop' in window) splash.remove();
  else {
    const fade = () => {
      splash.classList.add('out');
      setTimeout(() => splash.remove(), 650);
    };
    if (splash.dataset.done) fade();
    else window.addEventListener('fc-splash-done', fade, { once: true });
  }
}

// The Rust engine (shapes, animations, transitions…) loads before the first render so slides never
// draw without it; if it is slow or fails, the app starts anyway and shapes fall back to plain boxes.
void Promise.race([loadEngine(), new Promise((r) => setTimeout(r, 4000))]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
