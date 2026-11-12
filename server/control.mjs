// HTTP control API for Stream Deck / Bitfocus Companion / scripts:
//   GET /api/control/next            GET /api/control/clear/text
//   GET /api/control/macro/Sermon    GET /api/control/message?text=Hello
//   GET /api/control/status          (JSON: what is live)
// Set FREECAST_CONTROL_TOKEN to require ?token=… on every call.
const TOKEN = process.env.FREECAST_CONTROL_TOKEN || '';

const CLEAR = { all: 'live/clearAll', text: 'live/clearText', background: 'live/clearBackground', bg: 'live/clearBackground', props: 'prop/clearAll', message: 'live/message', announcements: 'announce/stop' };

function toCommand(parts, query) {
  const [cmd, a, b] = parts;
  switch (cmd) {
    case 'next': return { type: 'live/next' };
    case 'prev': case 'previous': return { type: 'live/prev' };
    case 'black': return { type: 'live/toggleBlack' };
    case 'logo': return { type: 'live/logo' };
    case 'clear': {
      const type = CLEAR[a ?? 'all'];
      return type ? (type === 'live/message' ? { type, message: null } : { type }) : null;
    }
    case 'macro': return a ? { type: 'macro/run', id: decodeURIComponent(a) } : null;
    case 'playlist': return a && /^\d+$/.test(a) ? { type: 'playlist/select', index: Number(a) - 1 } : null;
    case 'go': return a && b && /^\d+$/.test(b) ? { type: 'live/go', presentationId: decodeURIComponent(a), seq: Number(b) - 1 } : null;
    case 'message': return { type: 'live/message', message: query.get('text') };
    case 'stage-message': return { type: 'live/stageMessage', message: query.get('text') };
    case 'timer': return a && ['start', 'stop', 'reset'].includes(b) ? { type: 'timer/op', id: decodeURIComponent(a), op: b } : null;
    case 'prop': return a ? { type: 'prop/toggle', id: decodeURIComponent(a) } : null;
    default: return null;
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function controlMiddleware(wss) {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/control')) return next();
    if (TOKEN && url.searchParams.get('token') !== TOKEN) return send(res, 401, { error: 'Bad or missing token' });
    // Web pages open in a browser must not be able to drive the show (CSRF): refuse cross-site browser requests.
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    if (site === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) return send(res, 403, { error: 'Cross-site requests are not allowed' });
    const parts = url.pathname.replace(/^\/api\/control\/?/, '').split('/').filter(Boolean);
    if (!parts.length || parts[0] === 'help') {
      return send(res, 200, { commands: ['next', 'prev', 'black', 'logo', 'clear/{all|text|background|props|message|announcements}', 'macro/{name or id}', 'playlist/{n}', 'go/{presentationId}/{slide n}', 'message?text=', 'stage-message?text=', 'timer/{id}/{start|stop|reset}', 'prop/{id}', 'status'] });
    }
    if (parts[0] === 'status') {
      const s = wss.lastState();
      return send(res, 200, s ? { title: s.title, slide: s.slide?.text ?? null, group: s.slide?.group ?? null, next: s.nextText, black: s.black, logo: s.logo, message: s.message } : { title: null });
    }
    const command = toCommand(parts, url.searchParams);
    if (!command) return send(res, 400, { error: `Unknown command: ${parts.join('/')}` });
    const ok = wss.toHost(command);
    send(res, ok ? 200 : 503, ok ? { ok: true, command } : { error: 'The LightCast console is not open' });
  };
}
