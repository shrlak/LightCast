# End-to-end checks

Real Chromium against the built app (`dist/`), driven with Playwright. They run through vitest
with their own config (`vitest.e2e.config.ts`); `npx vitest run` does not pick them up.

```
npm run e2e                 # builds, serves dist/ on a free port, runs every check
npx vitest run --config vitest.e2e.config.ts tests/e2e/files.e2e.ts   # one file (after npm run build)
E2E_SHOTS=/some/dir npm run e2e   # where the screenshot of a failing check goes (default: temp folder)
```

Playwright is provided by the machine (`require('playwright')`), not by package.json. Set `E2E_CHROMIUM`
to a Chromium binary if the default one is not found. Chromium runs with fake microphone / camera
and auto-accepted screen capture. Fixtures (.pptx, .ppt, .odp, .lcast, .wmf/.emf, .svg, .png) are
built in memory by `fixtures.ts`; nothing binary is committed. Each check opens a fresh browser
profile, so checks do not depend on each other.

| File | Check | Covers |
| --- | --- | --- |
| files | app loads without console errors | first render, ribbon tab switch, no `console.error` / page error |
| files | opens a .pptx / .ppt / .odp through 파일 › 열기 | file chooser, import, the opened deck's slides on screen |
| files | .lcast wrong password, then right password | Korean error `암호가 올바르지 않…`, then the deck opens |
| files | .lcast save with a password | download starts with the `LCENC` header |
| files | Compare accepts a .ppt | 검토 › 비교 › file, 수정 내용 pane lists the revisions |
| commands | Alt+Q finds 붙여넣기 and its drop-down items | focus, results with `홈 › 클립보드 › 붙여넣기` |
| commands | runs a drop-down item | 붙여넣기 › 텍스트만 유지 from another tab, menu closes, no error |
| commands | 그림 글머리 기호 from search | file chooser opens, picture bullet drawn |
| editor | picture bullet from the 글머리 기호 drop-down | caret menu, file chooser, bullet in the slide |
| editor | background removal | 그림 서식 › 배경 제거 › 영역 표시 dialog, mark, 변경 내용 유지 |
| editor | ink to shape | rectangle stroke becomes a shape; with the switch off it stays ink |
| editor | version history | save a version, edit, restore the slide |
| media | audio recording | fake mic: record, stop, preview, insert (audio object on the slide) |
| media | screenshot dialog | fake display capture, crop by dragging, insert |
| media | metafile .wmf / .emf | inserted as a picture that decodes |
| media | SVG | inserted as a picture that decodes |
| export | embedded fonts checkbox | on the 저장 page, remembered |
| export | GIF | download starts with `GIF89a` |
| export | outline .rtf / .txt | files carry the slide text |
| export | video | panel opens; records a short video (fast path and real-time recorder) |
| show | slide show starts | presenter view, audience popup shows the slide, arrow key advances |
| show | laser pointer | Ctrl + move over the slide draws `.laser-dot` in the audience window |
| show | live captions, no speech | notice that this browser cannot recognise speech |
| show | live captions, stubbed SpeechRecognition | caption band in the audience window |
| show | 쇼 설정 monitor picker | renders (pickers, the permission button or the "cannot list" note) |

## Skipped / limits

Nothing is skipped. Limits worth knowing:

- Monitor picker: headless Chromium has one screen and no Window Management permission, so the check
  only proves the picker renders (the real choice of a second monitor needs hardware).
- Screen capture takes whatever the fake `--auto-select-desktop-capture-source` flag offers.
- Captions use a stub `SpeechRecognition`; Google's recogniser is not reachable from the test.
- While a text box is being edited the canvas does not draw list markers (only the thumbnails do), so the
  picture-bullet checks look at the slide pane.
