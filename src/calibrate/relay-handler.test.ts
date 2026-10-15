import { describe, it, expect } from 'vitest';
import { createMailbox } from './mailbox';
import { handleCalibRequest } from './relay-handler';

const S = 'f'.repeat(32);
const lan = ['192.168.1.20'];
const req = (method: string, url: string, body = '') => ({ method, url, body });

describe('handleCalibRequest', () => {
  it('posts then reads a message', () => {
    const mb = createMailbox(() => 0);
    expect(handleCalibRequest(mb, req('POST', `/calib/${S}/to-phone`, 'hi'), lan)).toEqual({ status: 200, json: { ok: true } });
    const r = handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=0`), lan);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ messages: [{ body: 'hi' }] });
  });
  it('treats a missing or bad after as 0', () => {
    const mb = createMailbox(() => 0);
    handleCalibRequest(mb, req('POST', `/calib/${S}/to-laptop`, 'yo'), lan);
    for (const q of ['', '?after=abc', '?after=-5']) {
      const r = handleCalibRequest(mb, req('GET', `/calib/${S}/to-laptop${q}`), lan);
      expect(r.json).toMatchObject({ messages: [{ body: 'yo' }] });
    }
  });
  it('answers /calib/info with the LAN addresses', () => {
    expect(handleCalibRequest(createMailbox(() => 0), req('GET', '/calib/info'), lan)).toEqual({ status: 200, json: { addresses: lan } });
  });
  it('refuses paths that do not match, wrong methods and oversize bodies', () => {
    const mb = createMailbox(() => 0);
    expect(handleCalibRequest(mb, req('GET', '/calib/short/to-phone'), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/elsewhere`), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone/extra`), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('GET', '/other'), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('DELETE', `/calib/${S}/to-phone`), lan).status).toBe(405);
    expect(handleCalibRequest(mb, req('POST', `/calib/${S}/to-phone`, 'x'.repeat(4_000_001)), lan).status).toBe(413);
  });
  it('answers 429 when there are too many sessions', () => {
    const mb = createMailbox(() => 0);
    for (const c of 'abcd') handleCalibRequest(mb, req('POST', `/calib/${c.repeat(32)}/to-phone`, 'x'), lan);
    expect(handleCalibRequest(mb, req('POST', `/calib/${'e'.repeat(32)}/to-phone`, 'x'), lan).status).toBe(429);
  });
});
