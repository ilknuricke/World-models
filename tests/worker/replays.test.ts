import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_TICKS, INTENT_QUANT, REPLAY_FORMAT, REPLAY_LIMITS, type DecodedReplay } from '../../src/contracts/drive';
import { REPLAY_API, ROOM_CODE_ALPHABET, type ReplayGetResponse, type ReplaySaveResponse } from '../../src/contracts/net';
import { encodeReplay, keyframesFor, samplesFor } from '../../src/sim-core/replay/format';
import app from '../../worker/index';
import { Windows } from '../../worker/limiter';
import { generateReplayId, SITEVERIFY_URL } from '../../worker/routes/replays';
import { MAX_DATA_CHARS } from '../../worker/schemas/replay';

/** Cloudflare's documented Turnstile test secrets: always passes / always fails. */
const PASS_SECRET = '1x0000000000000000000000000000000AA';
const FAIL_SECRET = '2x0000000000000000000000000000000AA';

// Node built-ins behind non-literal specifiers: this program type-checks with the Workers types only (no @types/node).
interface Stmt { all(...a: unknown[]): unknown[]; get(...a: unknown[]): unknown; run(...a: unknown[]): unknown }
interface DatabaseSync { exec(sql: string): void; prepare(sql: string): Stmt }
const { DatabaseSync } = (await import('node:sqlite' as string)) as { DatabaseSync: new (path: string) => DatabaseSync };
const { readFileSync } = (await import('node:fs' as string)) as { readFileSync: (path: string, enc: 'utf8') => string };
const MIGRATION = readFileSync('worker/migrations/0001_replays.sql', 'utf8');

/** D1 subset used by the route, on node:sqlite (same SQL dialect; batch = one transaction). */
function fakeD1(db: DatabaseSync) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    rows: () => db.prepare(sql).all(...args) as Record<string, unknown>[],
    first: async () => stmt(sql, args).rows()[0] ?? null,
    all: async () => ({ results: stmt(sql, args).rows() }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: ReturnType<typeof stmt>[]) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => ({ results: s.rows() }));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function setup(opts: { secret?: string | null; verdict?: 'model' | 'busy' | 'rules'; burst?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  const windows = new Windows();
  const admit = vi.fn(async (req: { rules: { key: string; limit: number }[]; windowMs: number }) => {
    if (opts.burst) return windows.hit(req.rules, req.windowMs, Date.now()) ? 'model' : 'busy';
    return opts.verdict ?? 'model';
  });
  const limiterNames: string[] = [];
  const env = {
    REPLAYS: fakeD1(db),
    LIMITER: { getByName: (name: string) => (limiterNames.push(name), { admit }) },
    ...(opts.secret === null ? {} : { TURNSTILE_SECRET: opts.secret ?? PASS_SECRET }),
  } as unknown as Env;
  const verify: FormData[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: FormData }) => {
    if (url !== SITEVERIFY_URL) throw new Error(`unexpected fetch ${url}`);
    verify.push(init.body);
    const ok = init.body.get('secret') === PASS_SECRET;
    return Response.json({ success: ok, 'error-codes': ok ? [] : ['invalid-input-secret'] });
  });
  return { db, env, admit, limiterNames, verify };
}
afterEach(() => vi.unstubAllGlobals());

function replay(seconds: number): DecodedReplay {
  const ticks = Math.round(seconds * 240);
  const intents = new Int16Array(samplesFor(ticks) * 5);
  for (let j = 0; j < intents.length; j += 5) intents[j + 1] = INTENT_QUANT.pedal; // full throttle, straight
  return {
    header: { format: REPLAY_FORMAT, simVersion: 'm2.1', paramsHash: '0123abcd', trackId: 'proving-loop', worldId: 'proving-ground', vehicleId: 'db11', suspensionId: 'double-wishbone', ticks },
    start: new Float64Array(110).fill(0.5),
    intents,
    events: [{ tick: 0, kind: 'aids', value: 'abs' }],
    keyframes: new Uint32Array(keyframesFor(ticks)),
  };
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}
const b64url = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const dataOf = async (seconds = 30) => b64url(await deflate(encodeReplay(replay(seconds))));

const post = (env: Env, body: unknown, headers: Record<string, string> = {}) =>
  app.request(
    '/api/replays',
    { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) },
    env,
  );
const count = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM replays').get() as { n: number }).n;

describe('POST /api/replays', () => {
  it('is off without the Turnstile secret: labelled 503, nothing counted or stored', async () => {
    const { env, db, admit } = setup({ secret: null });
    const res = await post(env, { token: 'x', data: await dataOf() });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured', message: 'Bu sunucuda tekrar kaydı etkin değil.' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(admit).not.toHaveBeenCalled();
    expect(count(db)).toBe(0);
  });

  it('saves (201 + 12-char id, 30-day expiry), loads it back byte for byte, dedupes by sha256', async () => {
    const { env, db, admit, limiterNames, verify } = setup();
    const data = await dataOf();
    const t0 = Date.now();
    const res = await post(env, { token: 'tok', data });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const saved = (await res.json()) as ReplaySaveResponse;
    expect(saved.id).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{12}$`));
    expect(saved.expiresAt - t0).toBeGreaterThanOrEqual(REPLAY_API.ttlMs);
    expect(saved.expiresAt - t0).toBeLessThan(REPLAY_API.ttlMs + 5000);
    expect(limiterNames).toEqual(['replays']);
    expect(admit).toHaveBeenCalledWith({ rules: [{ key: '203.0.113.9', limit: 5 }], windowMs: 60_000, budget: 2000 });
    expect([verify[0]!.get('secret'), verify[0]!.get('response'), verify[0]!.get('remoteip')]).toEqual([PASS_SECRET, 'tok', '203.0.113.9']);
    // metadata stored; no address or agent column exists
    const row = db.prepare('SELECT * FROM replays').get() as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['bytes', 'created_at', 'data', 'expires_at', 'id', 'seconds', 'sha256', 'sim_version', 'suspension', 'vehicle']);
    expect([row.sim_version, row.vehicle, row.suspension, row.seconds]).toEqual(['m2.1', 'db11', 'double-wishbone', 30]);

    const got = await app.request(`/api/replays/${saved.id}`, {}, env);
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toBe('public, max-age=300');
    const body = (await got.json()) as ReplayGetResponse;
    expect(body.data).toBe(data);
    expect(body.expiresAt).toBe(saved.expiresAt);

    const again = (await (await post(env, { token: 'tok2', data })).json()) as ReplaySaveResponse;
    expect(again.id).toBe(saved.id);
    expect(count(db)).toBe(1);
  });

  it('accepts the longest run (600 s)', async () => {
    const { env } = setup();
    expect((await post(env, { token: 't', data: await dataOf(REPLAY_LIMITS.maxSeconds) })).status).toBe(201);
  });

  it('400 for a bad envelope, undecodable data or a damaged/over-long replay; nothing counted', async () => {
    const { env, db, admit } = setup();
    const good = await dataOf();
    const garbage = b64url(new Uint8Array(64).fill(7));
    const notReplay = b64url(await deflate(new TextEncoder().encode('hello, not a replay')));
    const bytes = encodeReplay(replay(10));
    bytes[40] = bytes[40]! ^ 0xff; // CRC no longer matches
    const tooLong = await dataOf(REPLAY_LIMITS.maxSeconds + CONTROL_TICKS / 240 + 1); // decodes, but over 600 s
    for (const body of [
      'not json',
      [],
      { data: good },
      { token: '', data: good },
      { token: 't', data: good, extra: 1 },
      { token: 't', data: 'has spaces and +/=' },
      { token: 't', data: garbage },
      { token: 't', data: notReplay },
      { token: 't', data: b64url(await deflate(bytes)) },
      { token: 't', data: tooLong },
    ]) {
      const res = await post(env, body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(admit).not.toHaveBeenCalled();
    expect(count(db)).toBe(0);
  });

  it('413 for an oversized body (declared or streamed) or data over REPLAY_API.maxBytes', async () => {
    const { env, admit } = setup();
    expect((await post(env, { token: 't', data: 'A' }, { 'content-length': String(200_000) })).status).toBe(413);
    const big = JSON.stringify({ token: 't', data: 'A'.repeat(100 * 1024) });
    const stream = new Blob([big]).stream();
    const res = await app.request('/api/replays', { method: 'POST', body: stream, duplex: 'half' } as RequestInit, env);
    expect(res.status).toBe(413);
    expect((await post(env, { token: 't', data: 'A'.repeat(MAX_DATA_CHARS + 4) })).status).toBe(413);
    expect(admit).not.toHaveBeenCalled();
  });

  it('a decompression bomb (tiny blob, > 1 MB inflated) is refused as 400', async () => {
    const { env } = setup();
    const bomb = await deflate(new Uint8Array(2 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(REPLAY_API.maxBytes);
    expect((await post(env, { token: 't', data: b64url(bomb) })).status).toBe(400);
  });

  it('403 when Turnstile fails; nothing stored', async () => {
    const { env, db } = setup({ secret: FAIL_SECRET });
    const res = await post(env, { token: 'tok', data: await dataOf() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'turnstile' });
    expect(count(db)).toBe(0);
  });

  it('403 when siteverify is unreachable (fail closed)', async () => {
    const { env } = setup();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect((await post(env, { token: 'tok', data: await dataOf() })).status).toBe(403);
  });

  it('429 on a burst (6th save in a minute from one address), 503 daily_cap when the day is spent', async () => {
    const burst = setup({ burst: true });
    const data = await dataOf();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post(burst.env, { token: 't', data })).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await post(burst.env, { token: 't', data }, { 'cf-connecting-ip': '198.51.100.1' })).status).toBe(201);

    const capped = setup({ verdict: 'rules' });
    const res = await post(capped.env, { token: 't', data });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'daily_cap' });
    expect(capped.verify).toHaveLength(0);
  });

  it('purges expired rows on write (at most 50 per save)', async () => {
    const { env, db } = setup();
    const ins = db.prepare('INSERT INTO replays VALUES (?, 1, ?, ?, ?, ?, 1, 1, ?, ?)');
    for (let i = 0; i < 60; i++) ins.run(`OLD${String(i).padStart(9, 'A')}`, Date.now() - 1000, 'm2.1', 'db11', 'x', `h${i}`, new Uint8Array([1]));
    expect((await post(env, { token: 't', data: await dataOf() })).status).toBe(201);
    expect(count(db)).toBe(11);
    expect((await post(env, { token: 't', data: await dataOf(31) })).status).toBe(201);
    expect(count(db)).toBe(2);
  });

  it('a D1 failure is a labelled 503', async () => {
    const { env } = setup();
    (env as unknown as { REPLAYS: { batch: () => Promise<never> } }).REPLAYS.batch = async () => {
      throw new Error('D1_ERROR: database or disk is full');
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await post(env, { token: 't', data: await dataOf() });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'storage_unavailable' });
  });
});

describe('GET /api/replays/:id', () => {
  it('404 for malformed, unknown and expired ids (expiry enforced on read), uncached', async () => {
    const { env, db } = setup();
    db.prepare('INSERT INTO replays VALUES (?, 1, ?, ?, ?, ?, 1, 1, ?, ?)').run('ABCDEFGHJKMN', Date.now() - 1, 'm2.1', 'db11', 'x', 'h', new Uint8Array([1]));
    for (const id of ['abc', 'ABCDEFGHJKM0', "ABCDEFGHJK'N", 'ZZZZZZZZZZZZ', 'ABCDEFGHJKMN']) {
      const res = await app.request(`/api/replays/${id}`, {}, env);
      expect(res.status, id).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('GET /api/replays is not a listing (405)', async () => {
    const { env } = setup();
    expect((await app.request('/api/replays', {}, env)).status).toBe(405);
  });
});

describe('replay ids and the insight stub', () => {
  it('ids are 12 alphabet characters and do not repeat', () => {
    const ids = new Set(Array.from({ length: 2000 }, generateReplayId));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{12}$`));
  });

  it('GET /api/insight answers 501 until 12-06', async () => {
    const res = await app.request('/api/insight?station=x&suspension=y', {}, {} as Env);
    expect(res.status).toBe(501);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
