# Font sync: what the Worker must allow

The Worker is not in this repo. Font cloud sync (`src/domain/fontSync.ts`) needs the following from it.

1. **Media ids `font-<sha256 hex>`** are ordinary cloud media (same upload / download / list / delete calls as other media), up to **30 MB** each (`MAX_CLOUD_FONT_BYTES`), all fonts together under 100 MB. The id is the content hash: the same bytes are one object. Clients verify the hash after download.
2. **Media cleanup must not prune them.** They are not referenced by any slide or `Library.media` entry; they are referenced by `Library.fonts` (live) and `Library.fontTrash` (kept for `FONT_TRASH_DAYS` = 30 days, same as the media trash). Cleanup that deletes unreferenced media must treat every `font-*` id as referenced. Clients delete the file themselves once the trash period is over (or on "영구 삭제").
3. **Library fields passed through unchanged** in `PUT/GET library`: `fonts` (list of `CloudFont`), `fontTrash` (list of `{ id, entry, deletedAt, expiresAt }`), and `fontPrefs` (`{ global?: { enabled, includeDeckFonts, at }, fonts?: { [hash]: { sync: boolean | null, at } } }`, merged last-writer-wins by `at` on the client). Fonts that came out of .pptx files use the same ids and are marked `embedded: true` in their `fonts` entry.
4. Quota: font files count toward the server quota like other media; clients keep the last 5 % free.
