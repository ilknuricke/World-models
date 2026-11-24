/**
 * 11-03 replay feature: `#r=` links (deflate-raw + base64url, fallback encoder), errors, share limits, copy.
 * 12-05 saved runs: `#rid=` links, the save span, the save/load client against a fake fetch, the site-key switch.
 */
import { describe, expect, it } from 'vitest';
import { REPLAY_LIMITS, type DecodedReplay } from '../../src/contracts/drive';
import { COPY, FALLBACK, LINK_ERROR, lastMinutes, loadMessage, REFUSAL, SAVE_ERROR, savedPart, savingPart, shareSeconds, statusNote } from '../../src/features/replay/copy';
import { decodeFragment, detectPlatform, encodeFragment, fragmentOf, fromBase64Fallback, shareUrl, toBase64Fallback, type Platform } from '../../src/features/replay/link';
import { API, REPLAY_API } from '../../src/contracts/net';
import { isReplayId, loadSaved, ridOf, saveData, savedUrl, saveErrorOf, saveReplay, saveSpan, SAVED_KEY } from '../../src/features/replay/server';
import { SITE_KEY, siteKeyFor, TEST_SITE_KEYS } from '../../src/features/replay/turnstile';
import type { ReplayStatus } from '../../src/sim-core/drive/control';
import { encodeReplay } from '../../src/sim-core/replay/format';
import { host, manualSim, scriptedDriver } from '../fixtures/11-03-replay';

const run = (() => {
  const sim = manualSim(10);
  scriptedDriver(4, false)(sim, 8);
  return sim.drive!.recording()!;
})();
const same = (a: DecodedReplay, b: DecodedReplay) => expect(encodeReplay(a)).toEqual(encodeReplay(b));

const fallback: Platform = { compress: null, decompress: null, toBase64: toBase64Fallback, fromBase64: fromBase64Fallback };

describe('links', () => {
  it('round trip with CompressionStream (deflate-raw) and with the fallback encoder (no compression, btoa)', async () => {
    const native = detectPlatform();
    expect(native.compress).not.toBeNull();
    const z = await encodeFragment(run, native);
    expect(z).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeFragment(z, native);
    same((back as { replay: DecodedReplay }).replay, run);
    const raw = await encodeFragment(run, fallback);
    expect(raw.length).toBeGreaterThan(z.length * 3);
    same(((await decodeFragment(raw, fallback)) as { replay: DecodedReplay }).replay, run);
    // a browser without streams still opens an uncompressed link; a compressed one says it cannot
    same(((await decodeFragment(raw, native)) as { replay: DecodedReplay }).replay, run);
    expect(await decodeFragment(z, fallback)).toEqual({ error: 'unsupported' });
  });

  it('the fallback base64url codec equals the standard one on every byte value', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37 + 11) & 255);
    const s = toBase64Fallback(bytes);
    expect(s).toBe(Buffer.from(bytes).toString('base64url'));
    expect(Array.from(fromBase64Fallback(s))).toEqual(Array.from(bytes));
    for (let n = 0; n < 5; n++) expect(Array.from(fromBase64Fallback(toBase64Fallback(bytes.subarray(0, n))))).toEqual(Array.from(bytes.subarray(0, n)));
  });

  it('damaged, truncated, foreign or future links are error values, never exceptions', async () => {
    const z = await encodeFragment(run);
    expect(await decodeFragment(z.slice(0, z.length - 6))).toEqual({ error: 'damaged' });
    expect(await decodeFragment(`${z.slice(0, 40)}A${z.slice(41)}`)).toHaveProperty('error');
    expect(await decodeFragment('not a replay!')).toEqual({ error: 'damaged' });
    expect(await decodeFragment('')).toEqual({ error: 'damaged' });
    expect(await decodeFragment(toBase64Fallback(new Uint8Array([7, 1, 2, 3])))).toEqual({ error: 'newer-format' });
    const raw = encodeReplay(run);
    const newer = raw.slice();
    newer[3] = 0x32;
    expect(await decodeFragment(toBase64Fallback(new Uint8Array([0, ...newer])))).toEqual({ error: 'newer-format' });
    for (const e of ['damaged', 'newer-format', 'unsupported'] as const) expect(LINK_ERROR[e].length).toBeGreaterThan(10);
  });

  it('the run lives in the fragment, never the query string', () => {
    const url = shareUrl({ origin: 'https://lab.example', pathname: '/' }, 'abc_-');
    expect(url).toBe('https://lab.example/#r=abc_-');
    expect(new URL(url).search).toBe('');
    expect(fragmentOf('#r=abc')).toBe('abc');
    expect(fragmentOf('#r=')).toBeNull();
    expect(fragmentOf('#rid=xyz')).toBeNull();
  });
});

describe('share limits and honesty lines', () => {
  it('runs up to the fragment limit share whole; longer runs share their last minute (<= limit)', () => {
    expect(shareSeconds(240 * 30)).toEqual({ seconds: 30, truncated: false });
    expect(shareSeconds(240 * REPLAY_LIMITS.fragmentSeconds)).toEqual({ seconds: REPLAY_LIMITS.fragmentSeconds, truncated: false });
    const long = shareSeconds(240 * 125);
    expect(long.truncated).toBe(true);
    // the recorder rounds a window's start down to a whole second: + 1 s at most
    expect(long.seconds + 1).toBeLessThanOrEqual(REPLAY_LIMITS.fragmentSeconds);
  });

  it('labels another model version, other parameters and drift; silent when exact', () => {
    const s = { sameModel: true, sameVersion: true, mismatches: 0, resyncs: 0 } as ReplayStatus;
    expect(statusNote(s)).toBeNull();
    expect(statusNote({ ...s, sameVersion: false })).toMatch(/Eski bir modelle/);
    expect(statusNote({ ...s, sameModel: false })).toMatch(/farklı olabilir/);
    expect(statusNote({ ...s, mismatches: 1 })).toMatch(/farklı olabilir/);
    expect(statusNote({ ...s, mismatches: 1, resyncs: 1 })).toMatch(/Bundan sonrası yaklaşık/);
  });

  it('copy carries no digits', () => {
    const all = [...Object.values(COPY), ...Object.values(LINK_ERROR), ...Object.values(REFUSAL)];
    for (const text of all) expect(text, text).not.toMatch(/\d/);
  });
});

// ---------------------------------------------------------------- 12-05 saved runs

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ID = 'ABCDEFGH2345';

describe('saved runs (12-05)', () => {
  it('the production site key everywhere but a local host; the test keys only there', () => {
    const configuredKey = 'public-widget-id-for-this-deployment';
    expect(siteKeyFor({ hostname: 'lab.example.workers.dev', search: '' }, configuredKey)).toBe(configuredKey);
    expect(siteKeyFor({ hostname: 'lab.example.workers.dev', search: '?turnstile=pass' }, configuredKey)).toBe(configuredKey);
    expect(siteKeyFor({ hostname: 'evil.example', search: '?turnstile=fail' }, configuredKey)).toBe(configuredKey);
    expect(siteKeyFor({ hostname: 'localhost', search: '?e2e=1' })).toBe(TEST_SITE_KEYS.pass);
    expect(siteKeyFor({ hostname: '127.0.0.1', search: '?turnstile=fail' })).toBe(TEST_SITE_KEYS.fail);
    expect(siteKeyFor({ hostname: 'lab.example.workers.dev', search: '' }, '')).toBe('');
    expect(siteKeyFor({ hostname: 'lab.example.workers.dev', search: '' })).toBe(SITE_KEY);
  });

  it('#rid= links: id format, parsing, the url carries only the id in the fragment', () => {
    expect(isReplayId(ID)).toBe(true);
    for (const bad of ['', 'ABCDEFGH234', 'ABCDEFGH23456', 'ABCDEFGH234I', 'abcdefgh2345x', 'ABCDEFGH2340']) expect(isReplayId(bad), bad).toBe(false);
    expect(ridOf(`#rid=${ID}`)).toBe(ID);
    expect(ridOf(`#rid=${ID.toLowerCase()}`)).toBe(ID);
    expect(ridOf('#r=abc')).toBeNull();
    expect(ridOf('')).toBeNull();
    expect(fragmentOf(`#rid=${ID}`)).toBeNull();
    const url = savedUrl({ origin: 'https://lab.example', pathname: '/' }, ID);
    expect(url).toBe(`https://lab.example/${SAVED_KEY}${ID}`);
    expect(new URL(url).search).toBe('');
  });

  it('save then load through a fake server: the same replay comes back', async () => {
    let stored = '';
    let request: { url: string; init: RequestInit } | undefined;
    const server = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        request = { url, init };
        stored = (JSON.parse(String(init.body)) as { data: string }).data;
        return json(201, { id: ID, expiresAt: 1 });
      }
      return url === `${API.replays}/${ID}` ? json(200, { data: stored, createdAt: 0, expiresAt: 1 }) : json(404, { error: 'not_found' });
    }) as typeof fetch;
    const data = (await saveData(run))!;
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await saveReplay('tok', data, server)).toEqual({ id: ID, expiresAt: 1 });
    expect(request!.url).toBe(API.replays);
    expect(JSON.parse(String(request!.init.body))).toEqual({ token: 'tok', data }); // nothing else is sent
    const back = await loadSaved(ID, server);
    same((back as { replay: DecodedReplay }).replay, run);
    expect(await loadSaved('ZZZZZZZZZZZZ', server)).toEqual({ error: 'missing' });
  });

  it('every save failure is a labelled value', async () => {
    const answer = (status: number, error?: string) => (async () => json(status, error ? { error } : {})) as unknown as typeof fetch;
    const cases: [number, string | undefined, string][] = [
      [403, 'turnstile', 'challenge'],
      [429, 'busy', 'busy'],
      [503, 'daily_cap', 'daily_cap'],
      [503, 'storage_unavailable', 'storage'],
      [503, 'not_configured', 'disabled'],
      [503, undefined, 'storage'],
      [413, 'too_large', 'too_large'],
      [400, 'bad_replay', 'too_large'],
      [400, 'bad_request', 'failed'],
      [500, undefined, 'failed'],
      [201, undefined, 'failed'], // a 201 without a valid id
    ];
    for (const [status, error, want] of cases) {
      expect(saveErrorOf(status, error), `${status} ${error}`).toBe(status === 201 ? 'failed' : want);
      expect(await saveReplay('t', 'AA', answer(status, error)), `${status} ${error}`).toEqual({ error: want });
    }
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await saveReplay('t', 'AA', down)).toEqual({ error: 'offline' });
    const html = (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch;
    expect(await saveReplay('t', 'AA', html)).toEqual({ error: 'failed' });
  });

  it('every load failure is a labelled value; a bad id is never fetched', async () => {
    let calls = 0;
    const counting = (r: Response | Error) =>
      (async () => {
        calls++;
        if (r instanceof Error) throw r;
        return r;
      }) as unknown as typeof fetch;
    expect(await loadSaved('nope', counting(json(200, {})))).toEqual({ error: 'invalid' });
    expect(calls).toBe(0);
    expect(await loadSaved(ID, counting(json(404, { error: 'not_found' })))).toEqual({ error: 'missing' });
    expect(await loadSaved(ID, counting(new TypeError('offline')))).toEqual({ error: 'offline' });
    expect(await loadSaved(ID, counting(json(500, {})))).toEqual({ error: 'failed' });
    expect(await loadSaved(ID, counting(json(200, { data: '!!' })))).toEqual({ error: 'damaged' });
    expect(await loadSaved(ID, counting(json(200, { data: 'AAAAAAAA' })))).toEqual({ error: 'damaged' });
    expect(await loadSaved(ID, counting(new Response('x', { status: 200 })))).toEqual({ error: 'damaged' });
    for (const e of ['invalid', 'missing', 'offline', 'failed', 'damaged', 'newer-format', 'unsupported'] as const) expect(loadMessage(e).length).toBeGreaterThan(10);
  });

  it('the save span: the whole run when it fits, else the newest minutes that fit', async () => {
    const long = (() => {
      const sim = manualSim(10);
      scriptedDriver(5, false)(sim, 130);
      return host(sim);
    })();
    const whole = await saveSpan(long);
    expect(whole!.minutes).toBeNull();
    expect(whole!.replay.header.ticks).toBe(long.recording()!.header.ticks);
    expect(Math.floor((whole!.data.length * 3) / 4)).toBeLessThanOrEqual(REPLAY_API.maxBytes);
    // a platform whose output is over the byte cap unless the input is a minute or less
    const minute = encodeReplay(long.last(59)!).length;
    const native = detectPlatform();
    const bulky: Platform = { ...native, compress: async (b) => new Uint8Array(b.length > minute + 64 ? REPLAY_API.maxBytes + 1 : 64) };
    const part = await saveSpan(long, bulky);
    expect(part!.minutes).toBe(1);
    expect(part!.replay.header.ticks).toBeLessThanOrEqual(60 * 240);
    // a run at the recorder's limit is saved as its last ten minutes (strictly within the server's cap)
    const atLimit = { recording: () => ({ header: { ticks: REPLAY_LIMITS.maxSeconds * 240 } }) as DecodedReplay, last: (s: number) => (s === 599 ? run : null) };
    expect((await saveSpan(atLimit))!.minutes).toBe(10);
    // nothing fits / no compressor
    expect(await saveSpan(long, { ...native, compress: async () => new Uint8Array(REPLAY_API.maxBytes + 1) })).toBeNull();
    expect(await saveSpan(long, fallback)).toBeNull();
  }, 60_000);

  it('save copy carries no digits and says what is kept', () => {
    const all = [...Object.values(SAVE_ERROR).map((e) => e.text), ...Object.values(FALLBACK), lastMinutes(1), lastMinutes(10), savedPart(5), savingPart(2)];
    for (const text of all) expect(text, text).not.toMatch(/\d/);
    expect(COPY.savePrivacy).toMatch(/yalnızca kontrol girdileriniz ve başlangıç durumu/);
    expect(COPY.savePrivacy).toMatch(/Hesap veya kişisel bilgi gerekmez/);
    expect(lastMinutes(5)).toBe('son beş dakika');
    expect(lastMinutes(1)).toBe('son bir dakika');
  });
});
