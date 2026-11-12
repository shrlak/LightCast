# LightCast on Linux and FreeBSD

Every GitHub Release also carries Linux builds (x64), next to the universal Mac `.dmg` and the Windows `.exe`:

| File | Use |
|---|---|
| `LightCast-<version>-x86_64.AppImage` | Any distribution; makes itself executable and updates itself from `latest-linux.yml` |
| `LightCast-<version>-amd64.deb` | Debian, Ubuntu, Mint |
| `LightCast-<version>-x86_64.rpm` | Fedora, openSUSE, RHEL |
| `LightCast-<version>-x64.tar.gz` | Anything else (also what FreeBSD uses, below) |

Build one yourself: `npm run dist:linux`.

## FreeBSD

Electron does not ship a FreeBSD build, so there is no native LightCast package for it. Two ways to run it:

1. **Linux binary (Linuxulator).** `pkg install linux_base-rl9`, enable `linux` in `rc.conf` (`service linux start`),
   unpack the `.tar.gz` and run `./LightCast` with `--no-sandbox`. Display and audio work as for other Linux programs.
2. **Web app.** `npm ci && npm run build && npm start` serves the same editor to a browser
   (`server/serve.mjs`). The desktop-only parts (several output screens, PowerPoint conversion) need the desktop app.
