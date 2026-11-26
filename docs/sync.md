# Cloud sync: how it works and how it is tested

## The later edit wins (server time)

- **Server clock** (`src/domain/serverClock.ts`): every answer from the church Worker carries its `Date` header, passed on by
  the local server as `x-lightcast-server-date` (`server/cloud.mjs`). Each answer bounds the offset between this computer
  and the server (`[Date − received, Date + 1 s − sent]`); intersecting recent answers gives the offset to within about
  half a round trip. Edits are stamped with `serverNow()`, so a wrong computer clock does not change who "edited last".
- **Stamps** (`src/domain/editStamps.ts`): the reducer stamps exactly what a person's edit changed — a presentation's
  `updatedAt` and `fieldsEditedAt[field]`, a slide's `editedAt` (its body) and `fieldsEditedAt.elements/comments`, each text
  box / picture / comment's `editedAt`, list items' `editedAt` + `fieldsEditedAt`, and the library's
  `fieldsEditedAt['sunday.<setting>' | 'logoMediaId' | 'retreat']`. Sync merges and automatic refreshes are not stamped.
- **Merge** (`src/domain/cloudMerge.ts`): three-way against the last synced copy. What only one side changed is taken from
  it; a part both changed takes its later stamp. Different slides, different text boxes, different fields all survive.
  Deleted on one device and edited on another: the later of the two wins (deletion times come from the trash). A revived
  presentation or slide also gets the deleting device's own changes (its trash copies, part by part); a deletion that
  wins keeps the newer edit in the trash copy. Nothing is ever kept twice and nothing is asked.
- **Typing during a round**: `library/merge` carries `from` (the library the merge was worked out from); edits made in the
  meantime are merged in by the reducer instead of being overwritten.

## Speed

- Push 0.3 s after a change (at most 1.5 s while changes keep coming), straight to `PUT` (a 409 gives the newer library).
- Ask for other devices' edits every 1 s while anyone is editing (3 min after the last change seen), 2 s on screen, 4 s
  behind another window, 8 s idle, 30 s hidden; after failures 5 s, 10 s … 3 min (`src/domain/syncStatus.ts`).
- A quiet ask is one `GET library?known=N` answered `204`; media and fonts move only when the library changed, files are
  waiting (3 s, 6 s, 12 s … back-off), or every 5 minutes. Keys and sync forms are remembered per object, so a round after a
  keystroke works out one presentation, not the whole library.

## Stress suites

`tests/stress*.test.ts` run randomised sessions on simulated servers (`tests/helpers/cloudSim.ts`, a fake of the Worker
API) and devices running the real sync code; `tests/helpers/syncSession.ts` lists what every session checks (one library
everywhere, every part its latest edit, existence by the latest event, sync settles, no file lost).

```
npx vitest run tests/stress                                         # 30 sessions per scenario (part of npm test)
SYNC_STRESS_RUNS=5000 npx vitest run tests/stress --maxWorkers=3    # the deep run
SYNC_STRESS_ONLY=<seed> SYNC_TRACE=1 npx vitest run tests/stressSyncFaults.test.ts -t "server outages"   # replay one
```

`SYNC_STRESS_REPORT=<dir>` writes a JSON line per scenario (and the measured edit-to-other-device delays) there.
