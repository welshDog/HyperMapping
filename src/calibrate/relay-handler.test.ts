import { describe, it, expect } from 'vitest';
import { createMailbox } from './mailbox';
import { chooseLanAddresses, handleCalibRequest } from './relay-handler';

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
  it('after=latest returns no messages and the current cursor', () => {
    const mb = createMailbox(() => 0);
    handleCalibRequest(mb, req('POST', `/calib/${S}/to-phone`, 'old'), lan);
    const seq = mb.after(S, 'to-phone', 0)[0].seq;
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=latest`), lan)).toEqual({ status: 200, json: { messages: [], cursor: seq } });
    expect(handleCalibRequest(mb, req('GET', `/calib/${'a'.repeat(32)}/to-phone?after=latest`), lan).json).toEqual({ messages: [], cursor: 0 });
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=${seq - 1}`), lan).json).toMatchObject({ messages: [{ body: 'old' }] });
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=${seq}`), lan).json).toEqual({ messages: [] });
  });
  it('only an empty numeric-after GET asks the server to hold the request', () => {
    const mb = createMailbox(() => 0);
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=latest`), lan).poll).toBeFalsy();
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=0`), lan).poll).toBe(true);
    handleCalibRequest(mb, req('POST', `/calib/${S}/to-phone`, 'x'), lan);
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=0`), lan).poll).toBeFalsy();
    expect(handleCalibRequest(mb, req('POST', `/calib/${S}/to-phone`, 'y'), lan).poll).toBeFalsy();
    expect(handleCalibRequest(mb, req('GET', '/calib/info'), lan).poll).toBeFalsy();
  });
});

describe('chooseLanAddresses', () => {
  it('drops link-local and keeps the real LAN address', () => {
    expect(chooseLanAddresses(['169.254.83.107', '192.168.50.129'])).toEqual(['192.168.50.129']);
  });
  it('ranks 192.168 before 10.x before 172.16-31 before others, keeping order within a class', () => {
    expect(chooseLanAddresses(['8.8.8.8', '172.20.0.5', '10.0.0.2', '192.168.1.9', '10.0.0.1', '192.168.1.2'])).toEqual([
      '192.168.1.9',
      '192.168.1.2',
      '10.0.0.2',
      '10.0.0.1',
      '172.20.0.5',
      '8.8.8.8',
    ]);
  });
  it('counts 172.16-31 as private but not 172.32', () => {
    expect(chooseLanAddresses(['172.32.0.1', '172.31.0.1'])).toEqual(['172.31.0.1', '172.32.0.1']);
  });
  it('drops loopback, 0.0.0.0 and garbage', () => {
    expect(chooseLanAddresses(['127.0.0.1', '0.0.0.0', 'nope', '1.2.3', '256.1.1.1', '::1', '1.2.3.4.5', '10.0.0.1'])).toEqual(['10.0.0.1']);
  });
  it('removes duplicates', () => {
    expect(chooseLanAddresses(['192.168.1.2', '192.168.1.2'])).toEqual(['192.168.1.2']);
  });
});
