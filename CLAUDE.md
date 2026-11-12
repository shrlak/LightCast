# LightCast

## Releases

Every release, every time:

- Bump `version` in `package.json` and `package-lock.json` (both places in the lock file), commit, push, open a PR and merge it.
- Version numbers count like an odometer, from the last digit: each release adds 1 to the last number, and when a number would pass 9 it goes back to 0 and the number to its left goes up by 1 (`0.2.0` → `0.2.1` → … → `0.2.9` → `0.3.0` → … → `0.9.9` → `1.0.0`). Only a release the user asks for by number (e.g. "make this 0.2.0") jumps to that number.
- Merge every PR once its checks pass (the user only runs the release workflow).
- The GitHub Release for `v<version>` must carry **all three installers**: Apple Silicon Mac `LightCast-<version>-arm64.dmg`, Intel Mac `LightCast-<version>.dmg` and Windows `LightCast-Setup-<version>.exe` (plus the `.zip` / `latest*.yml` files the auto-updater reads). `.github/workflows/release.yml` builds them and its `verify` job fails when one is missing.
- The workflow starts by itself when the version bump reaches `main` (a push that changes `package.json`); it skips a version whose release already exists. It can still be run by hand (Actions → Release → Run workflow, branch `main`). Do not tell the user to run it; check that the run started and finished green.
- Installed copies update themselves from the release, so a release is only done when the three files are really there.
- Keep a local checkout in step with `main` (`git pull`); `npm run release` publishes the same three installers from a local machine.

## Checks

`npx tsc --noEmit -p .` and `npx vitest run` must pass before every push.
