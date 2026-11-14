import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseOdp, writeOdp } from '../src/domain/io/odp';
it('dump', async () => {
  const f = process.env.ODP_IN; if (!f) return;
  const media = new Map<string, { bytes: Uint8Array; mime: string }>();
  let n = 0;
  const doc = await parseOdp(new Uint8Array(readFileSync(f)), { storeImage: (bytes, mime) => { const id = `img${++n}`; media.set(id, { bytes, mime }); return id; } });
  if (process.env.ODP_OUT) writeFileSync(process.env.ODP_OUT, JSON.stringify(doc, null, 1));
  if (process.env.ODP_REWRITE) writeFileSync(process.env.ODP_REWRITE, await writeOdp({ title: doc.title, properties: doc.properties, slides: doc.slides }, { loadMedia: (id) => media.get(id) ?? null }));
  if (process.env.DECK_JSON) {
    const deck = JSON.parse(readFileSync(process.env.DECK_JSON, 'utf8'));
    writeFileSync(process.env.DECK_ODP!, await writeOdp(deck, { loadMedia: (id) => media.get(id) ?? null }));
  }
});
