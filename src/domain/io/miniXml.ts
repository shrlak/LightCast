// A small, dependency-free XML reader (no DOMParser, so it also runs in tests and workers).
// Enough for OpenDocument files: elements, attributes, text, CDATA, comments, entities.

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: (XNode | string)[];
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[e] ?? m;
  });
}

export const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Parse an XML document into its root element. Throws on mismatched or missing tags. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#document', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[6] !== undefined) top.children.push(unescapeXml(m[6]));
    else if (m[3] !== undefined) {
      if (m[2]) {
        if (stack.length < 2 || top.name !== m[3]) throw new Error(`XML: unexpected </${m[3]}>`);
        stack.pop();
      } else {
        const attrs: Record<string, string> = {};
        for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '');
        const node: XNode = { name: m[3], attrs, children: [] };
        top.children.push(node);
        if (m[5]) continue;
        stack.push(node);
      }
    }
  }
  if (stack.length !== 1) throw new Error('XML: unclosed element');
  const el = root.children.find((c): c is XNode => typeof c !== 'string');
  if (!el) throw new Error('XML: no root element');
  return el;
}

export const elementsOf = (n: XNode): XNode[] => n.children.filter((c): c is XNode => typeof c !== 'string');
export const childrenNamed = (n: XNode, name: string): XNode[] => elementsOf(n).filter((c) => c.name === name);
export const childNamed = (n: XNode, name: string): XNode | undefined => elementsOf(n).find((c) => c.name === name);
export const textOf = (n: XNode): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
