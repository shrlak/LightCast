# DeckCraft ↔ LightCast: feature comparison (2026-11-24)

A full pass over DeckCraft (`storytold/deckcraft` at `9db2fa0c`) against LightCast 1.3.0: all 331 engine commands
(`crates/engine/src/**`, `cmd!` / `CommandSpec`), every ribbon tab and contextual tab (`crates/ui-egui/src/ribbon/*`),
the panes, dialogs, status bar, Quick Access Toolbar, backstage and slide show. The rule for this pass: apart from
the 예배 tab and the KCCP slide generator, LightCast should have DeckCraft's features and look the same way.

## Added or redesigned to match DeckCraft (v1.3.0)

| DeckCraft | LightCast now | Where |
|---|---|---|
| **Diagram Design** contextual tab (`ribbon/smartart.rs`) | **SmartArt 디자인** tab of its own (was a group inside 도형 서식): 텍스트 창, 도형 추가 ▾ (뒤에/앞에/위에/아래에/어시스턴트), 수준 올리기/내리기, 오른쪽에서 왼쪽, 위로/아래로 이동, 그림 삽입 · 레이아웃 갤러리 · 색 변경 · 스타일 (3차원 구분) · 그래픽 원래대로, 변환 (텍스트로 — 수준 유지 / 도형으로) · 정렬 | `src/ui/ppt/tabSmartArt.tsx` |
| Quick Access Toolbar (`ribbon/qat.rs`): Customize menu, right-click a ribbon button to add, remove, reset | **빠른 실행 도구 모음 사용자 지정** ⌄ menu (홈 · 새로 만들기 · 열기 · 저장 · 인쇄 · 실행 취소 · 다시 실행 · 처음부터 시작 · 찾기 · 맞춤법 검사 · 내보내기), right-click any ribbon button → 빠른 실행 도구 모음에 추가, right-click a toolbar button → 제거 / 왼쪽·오른쪽으로 이동, 기본값으로 다시 설정 | `src/domain/qat.ts`, `src/ui/ppt/Qat.tsx` |
| Animation Pane advanced timeline (`panels/animtimeline.rs`) | **⏱ 고급 타임라인**: a bar per effect in its click step; drag to change the delay, drag the right edge to change the duration (0.05 s steps, 600 s cap, repeats counted) | `src/domain/animTimeline.ts`, `src/ui/ppt/panes.tsx` |
| View › Dark Mode (`view.dark`) | **보기 › 어두운 모드** (this computer). The dark stylesheet is generated from the light one (`node scripts/make-dark-css.mjs`; a test fails when it is stale). Slides and output screens are unchanged | `src/domain/appearance.ts`, `scripts/darkCss.mjs`, `src/ui/ppt/dark.css` |
| Slide Show › Show Media Controls (`show.setup showMediaControls`, on by default) | **미디어 컨트롤 표시** check box (ribbon and 쇼 설정): in a show, pointing at the bottom of a video shows play / pause, a seek bar and the time | `src/ui/SlideCanvas.tsx` (`MediaBar`), `src/domain/live.ts` |
| Eyedropper in every colour menu (`eyedropper.rs`) | **스포이트** in every colour menu (글꼴 색, 도형 채우기/윤곽선, 텍스트 채우기, 표, 차트 …), where the browser has an eyedropper (Chromium / Electron) | `src/ui/ppt/ribbonParts.tsx` |
| Home › Font: Superscript / Subscript buttons | **위 첨자 / 아래 첨자** buttons (characters being typed, as in the 글꼴 dialog) | `TextFormatPanel.tsx`, `editor.ts` |
| Home › Designer › Design Ideas | **홈 › 디자이너 › 디자인 아이디어** | `tabsMain.tsx` |
| Font list › Rescan Installed Fonts (`font.rescan`) | **설치된 글꼴 다시 검색** at the end of the font list (adds every installed family where the browser can list them) | `FontPicker.tsx` |
| Draw: Black / Red / Blue Pen, Pencil, Highlighter | Pens named 검은색 펜 · 빨간색 펜 · 파란색 펜 …, and **연필** (thin grey pen) | `tabsMain.tsx` (`DrawTab`) |
| Status bar language (opens Language, shows the text's language) | The status bar shows the selected text's proofing language and opens **언어** | `PptLayout.tsx` |
| #2069 WMF scale / offset mapping records | Ported in v1.2.9 (`metafile/gdi.ts`, `Gdi.pageXf`) | `tests/metafile.test.ts`, `tests/deckcraftParity.test.ts` |

## Already the same (checked, no change)

Home (clipboard + 붙여넣기 옵션, 슬라이드/레이아웃/다시 설정/구역, 글꼴 · 단락 groups, 그리기, 찾기/바꾸기/글꼴 바꾸기/선택),
Insert (표 incl. 표 그리기, 그림, 사진 앨범, 도형, 아이콘, SmartArt, 차트, 확대/축소, 링크, 실행, 메모, 텍스트 상자, 머리글/바닥글,
WordArt, 날짜 및 시간, 슬라이드 번호, 수식, 기호, 비디오, 오디오), Draw (선택, 지우개, 펜, 형광펜, 잉크를 셰이프로/텍스트로),
Design (테마, 테마 찾아보기, 변형 › 색 · 글꼴 · 효과 · 배경 스타일, 슬라이드 크기, 배경 서식, 디자이너), Transitions, Animations
(갤러리, 효과 옵션, 애니메이션 추가, 애니메이션 창, 트리거, 애니메이션 복사, 시작/재생 시간/지연, 순서 바꾸기), Slide Show
(처음부터, 현재 슬라이드부터, 재구성한 쇼, 쇼 설정, 슬라이드 숨기기, 예행 연습, 녹화, 타이밍 사용, 내레이션 재생, 발표자 보기),
Review (맞춤법, 동의어 사전, 언어, 비교 · 모두 적용 · 검토 끝내기, 메모 새로 만들기/삭제/이전/다음/표시), View (기본, 개요, 여러 슬라이드,
슬라이드 노트, 읽기용 보기, 마스터 보기, 눈금자/눈금선/안내선, 눈금 및 안내선, 확대/축소, 창에 맞춤, 회색조, 새 창),
contextual tabs 도형 서식 · 그림 서식 (배경 제거, 수정, 색 › 다시 칠하기 / 투명한 색 설정, 꾸밈 효과, 투명도, 그림 압축, 그림 바꾸기,
그림 원래대로, 그림 스타일, 테두리, 효과, 대체 텍스트, 자르기) · 테이블 디자인 / 레이아웃 · 차트 디자인 · 재생, the selection pane,
comments pane, format pane, status bar zoom and views, and the engine commands behind them.

## Different on purpose (not changed)

- **예배 tab** and everything worship-specific (이번 주 예배, 콘티, 찬양, 재생목록, 예배 중), and the **KCCP slide generator** pieces
  (KCCP themes and backgrounds in 디자인, 주일예배 마법사, 수련회, the KCCP 미디어팀 mark in the status bar). Kept as they are.
- **DeckCraft placeholders that do nothing yet**: Cameo ("Camera capture is not available yet"), Translate ("not bundled"),
  Ink to Math / Ink to Text ("coming soon"), Insert › Screenshot ("not available yet"). LightCast already has working
  녹화, 화면 캡처 and 잉크를 텍스트로, so nothing is taken out.
- **Not applicable** (as in `docs/deckcraft-sync.md`): 16:9 slide sizes, desktop file dialogs, automation-only commands
  (`*.list`, `*.inspect`, `text.compose`, `file.openBytes` …), DeckCraft's own CI, About/Credits for DeckCraft.

## Still different — needs a decision or a larger change

1. **Check Accessibility (접근성 검사)**: DeckCraft has it (Review › Accessibility); LightCast removed it on purpose in
   v0.9.4. Left out until you say to bring it back.
2. **Slide Master / Handout Master / Notes Master as ribbon tabs**: DeckCraft edits masters on the main canvas with
   contextual 슬라이드 마스터 / 유인물 마스터 / 슬라이드 노트 마스터 tabs (Insert Layout, Delete, Rename, Preserve, Title,
   Footers, Insert Placeholder, Themes, Background Styles, Close Master View; per-placeholder check boxes). LightCast opens
   the slide master in its own window-sized view with the same commands, and its handout / notes masters are print
   settings. Same functions, different design; moving them into the ribbon is a larger rewrite of `MasterView.tsx`.
3. **Backstage (파일)**: DeckCraft has New (template gallery), Open with Recent / Recover Unsaved, Save As, Close,
   Info › Properties / Revert / Appearance, About. LightCast saves automatically into its library and syncs, so it has
   no Save As / Close / Revert; it has 복원 지점, 휴지통, 문서 검사 and 속성 instead. The appearance switch is on the View tab.
4. **SmartArt Text Pane** is a docked pane in DeckCraft; LightCast opens it as the 텍스트 창 dialog (same editing).
5. **PPTX `presProps` › `p:showPr`** (loop, narration, media controls) is neither read nor written by LightCast's PPTX
   reader/writer; the show settings stay in LightCast's own file and library.
