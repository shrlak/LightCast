# Keeping LightCast in step with DeckCraft

LightCast's editor follows [DeckCraft](https://github.com/storytold/deckcraft) (a Rust PowerPoint
clone, MIT / Apache-2.0). Its commands live in `crates/engine/src/cmd/**/*.rs`; the engine inside
LightCast (`engine/`) is built from DeckCraft's crates plus `engine/freecast-engine`.

Last DeckCraft commit LightCast has been compared against and brought up to date with:

```
DECKCRAFT_SYNCED=6eebec7df67e7b42118496e010d35d0bce1df15d
```

(`Decrease Font Size steps down one size at a time from any size (#2070)`.)

## The routine (run by a scheduled Claude session; also fine to run by hand)

1. Clone or update DeckCraft (`git clone https://github.com/storytold/deckcraft` into a scratch
   folder, or `git pull` there). Read `DECKCRAFT_SYNCED` above.
2. `git log --oneline $DECKCRAFT_SYNCED..origin/main` in DeckCraft. If it is empty: stop, do nothing,
   do not open a PR.
3. Read each new commit's diff (`git show`, limited to `crates/` and the app UI). Classify the change:
   - **Behaviour or feature in an area LightCast has** (text, shapes, pictures, tables, SmartArt,
     animations, transitions, review, view, master, find, clipboard…): port it. Engine logic goes
     into `engine/freecast-engine` (or the vendored DeckCraft crates under `engine/`) and the app
     side into `src/`; run `cd engine && cargo test` and `npm run engine` when Rust changed.
   - **A new DeckCraft feature LightCast lacks:** add it, with Korean UI labels matching PowerPoint's
     Korean UI, the app's green/yellow look, and tests.
   - **Not applicable** (16:9 slide sizes — slides stay 4:3; desktop file dialogs; automation-only
     queries) or **removed on purpose** (accessibility checker; stage / worship-team / preacher
     screens; 예배 전 준비·점검, 안전 모드, 대기 컴퓨터; the six moving background presets): skip it.
4. Update `DECKCRAFT_SYNCED` in this file to DeckCraft's current `origin/main` commit, and add a line
   per ported commit to the list below.
5. Release as in `CLAUDE.md`: `npx tsc --noEmit -p .` and `npx vitest run` must pass; bump the
   version (odometer rule), commit, push, open a PR, merge it once its checks pass, and check that the
   release has the universal Mac `.dmg`, the Windows `.exe` and the update files.
6. If a change is too large or unclear to port safely in one run, port what is safe, leave
   `DECKCRAFT_SYNCED` at the last fully handled commit, and say what is left in the PR description.

## Ported so far

- Everything up to `6eebec7` (see README, "더 많은 DeckCraft 기능").
