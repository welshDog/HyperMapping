import { createMailbox, type Box, type Mailbox } from './mailbox';
import { MAX_BODY_CHARS } from './protocol';

export interface RelayRequest {
  method: string;
  url: string;
  body: string;
}
export interface RelayResponse {
  status: number;
  json: unknown;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Keep only addresses a phone could use, most likely first: 192.168, then 10, then 172.16-31, then the rest. */
export function chooseLanAddresses(candidates: string[]): string[] {
  const classes: string[][] = [[], [], [], []];
  const seen = new Set<string>();
  for (const c of candidates) {
    const m = IPV4.exec(c);
    if (!m || seen.has(c)) continue;
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) continue;
    if (o[0] === 127 || o[0] === 0 || (o[0] === 169 && o[1] === 254)) continue;
    seen.add(c);
    if (o[0] === 192 && o[1] === 168) classes[0].push(c);
    else if (o[0] === 10) classes[1].push(c);
    else if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) classes[2].push(c);
    else classes[3].push(c);
  }
  return classes.flat();
}

const PATH = /^\/calib\/([0-9a-f]{32})\/(to-phone|to-laptop)$/;

/** Everything the relay does, as a pure function of the request. The Vite plugin only adapts Node to this. */
export function handleCalibRequest(mailbox: Mailbox, req: RelayRequest, lanAddresses: string[]): RelayResponse {
  const url = new URL(req.url, 'http://relay.invalid');
  if (url.pathname === '/calib/info') {
    return req.method === 'GET' ? { status: 200, json: { addresses: lanAddresses } } : { status: 405, json: { error: 'method' } };
  }
  const m = PATH.exec(url.pathname);
  if (!m) return { status: 404, json: { error: 'not found' } };
  const session = m[1];
  const box = m[2] as Box;
  if (req.method === 'POST') {
    if (req.body.length > MAX_BODY_CHARS) return { status: 413, json: { error: 'too big' } };
    const r = mailbox.post(session, box, req.body);
    if (r === 'ok') return { status: 200, json: { ok: true } };
    if (r === 'full') return { status: 429, json: { error: 'too many sessions' } };
    if (r === 'too-big') return { status: 413, json: { error: 'too big' } };
    return { status: 400, json: { error: 'bad request' } };
  }
  if (req.method === 'GET') {
    const raw = Number(url.searchParams.get('after') ?? '0');
    const after = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return { status: 200, json: { messages: mailbox.after(session, box, after) } };
  }
  return { status: 405, json: { error: 'method' } };
}

export { createMailbox };
