import os from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createMailbox } from '../src/calibrate/mailbox';
import { MAX_BODY_CHARS } from '../src/calibrate/protocol';
import { chooseLanAddresses, handleCalibRequest } from '../src/calibrate/relay-handler';

const POLL_MS = 250;
const LONG_POLL_MS = 20_000;

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return chooseLanAddresses(out);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let body = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > MAX_BODY_CHARS) {
        tooBig = true;
        body = '';
      }
    });
    req.on('end', () => resolve(tooBig ? null : body));
    req.on('error', () => resolve(null));
  });
}

function send(res: ServerResponse, status: number, json: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(json));
}

/** Hosts the laptop <-> phone mailbox inside the dev and preview servers (LAN use only, in memory). */
export function calibrationRelay(): Plugin {
  const mailbox = createMailbox();
  type Mw = { use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void };
  const attach = (middlewares: Mw) => {
    middlewares.use((req, res, next) => {
      const url = req.url ?? '';
      if (!url.startsWith('/calib/')) return next();
      const method = req.method ?? 'GET';
      void (async () => {
        const body = method === 'POST' ? await readBody(req) : '';
        if (body === null) return send(res, 413, { error: 'too big' });
        const run = () => handleCalibRequest(mailbox, { method, url, body }, lanAddresses());
        let r = run();
        if (method === 'GET' && r.status === 200 && Array.isArray((r.json as { messages?: unknown }).messages)) {
          // Long poll: wait for a message, up to 20 s, giving up if the client goes away.
          let closed = false;
          res.on('close', () => (closed = true));
          const until = Date.now() + LONG_POLL_MS;
          while ((r.json as { messages: unknown[] }).messages.length === 0 && Date.now() < until && !closed) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            r = run();
          }
          if (closed) return;
        }
        send(res, r.status, r.json);
      })();
    });
  };
  return {
    name: 'hypermapping-calibration-relay',
    configureServer(server) {
      attach(server.middlewares as unknown as Mw);
    },
    configurePreviewServer(server) {
      attach(server.middlewares as unknown as Mw);
    },
  };
}
