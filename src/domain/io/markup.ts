// A small, forgiving XML / HTML reader for clipboard contents (PowerPoint's DrawingML clipboard part
// and the HTML Office and browsers put on the clipboard). It runs anywhere (no DOMParser), keeps
// namespace prefixes in names ("a:sp"), and never throws: unclosed and stray tags are tolerated.

export interface MNode {
  name: string;
  attrs: Record<string, string>;
  children: MNode[];
  /** Text nodes have the name "#text". */
  text?: string;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'o:p']);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** The document as a tree under a "#root" node. `html` lower-cases names and knows void elements. */
export function parseMarkup(src: string, html = false): MNode {
  const root: MNode = { name: '#root', attrs: {}, children: [] };
  const stack: MNode[] = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) top().children.push({ name: '#text', attrs: {}, children: [], text: m[1] });
    else if (m[2] !== undefined) {
      const name = html ? m[2].toLowerCase() : m[2];
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
    } else if (m[3] !== undefined) {
      const name = html ? m[3].toLowerCase() : m[3];
      const node: MNode = { name, attrs: parseAttrs(m[4]), children: [] };
      top().children.push(node);
      if (!m[5] && !(html && VOID.has(name))) {
        stack.push(node);
        // Script and style bodies are not markup.
        if (html && (name === 'script' || name === 'style')) {
          const end = src.toLowerCase().indexOf(`</${name}`, re.lastIndex);
          const stop = end < 0 ? src.length : end;
          node.children.push({ name: '#text', attrs: {}, children: [], text: src.slice(re.lastIndex, stop) });
          re.lastIndex = stop;
        }
      }
    } else if (m[6] !== undefined) {
      top().children.push({ name: '#text', attrs: {}, children: [], text: decodeEntities(m[6]) });
    }
  }
  return root;
}

/** The part of a name after its namespace prefix. */
export const local = (n: MNode) => n.name.slice(n.name.indexOf(':') + 1);
/** The first child with this local name. */
export const child = (n: MNode | null | undefined, name: string): MNode | null => n?.children.find((c) => local(c) === name) ?? null;
export const kids = (n: MNode | null | undefined, name: string): MNode[] => n?.children.filter((c) => local(c) === name) ?? [];
/** A chain of children: path(sp, 'spPr', 'xfrm', 'off'). */
export const path = (n: MNode | null | undefined, ...names: string[]): MNode | null => names.reduce<MNode | null>((a, k) => child(a, k), n ?? null);
/** Every descendant with this local name, in document order. */
export function find(n: MNode, name: string, out: MNode[] = []): MNode[] {
  for (const c of n.children) {
    if (local(c) === name) out.push(c);
    find(c, name, out);
  }
  return out;
}
/** All the text under a node. */
export const textOf = (n: MNode): string => (n.name === '#text' ? n.text ?? '' : n.children.map(textOf).join(''));
