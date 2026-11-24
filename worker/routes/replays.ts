/**
 * Shared replays on D1 (ARCHITECTURE-M2 §12.1). Replays are untrusted input: capped body, strict envelope, capped
 * base64url and decompressed sizes, structural decode with the sim-core format (no re-simulation in the Worker),
 * Turnstile + the `replays` Limiter (per address per minute, global per UTC day). The stored blob is the opaque
 * compressed bytes that were validated; no IP, user agent or client id is stored. Expiry: checked on read, purged on
 * write (no cron).
 */
import { Hono, type Context } from 'hono';
import { REPLAY_LIMITS } from '../../src/contracts/drive';
import {
  API,
  REPLAY_API,
  ROOM_CODE_ALPHABET,
  type ErrorResponse,
  type ReplayGetResponse,
  type ReplaySaveResponse,
} from '../../src/contracts/net';
import { SIM_HZ } from '../../src/contracts/units';
import { decodeReplay } from '../../src/sim-core/replay/format';
import { MAX_BODY_BYTES, MAX_DATA_CHARS, REPLAY_ID, replaySaveSchema } from '../schemas/replay';

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Decompressed replay cap (a 600 s run is well under 100 KB raw). */
export const MAX_RAW_BYTES = 1024 * 1024;
/** Expired rows deleted per save. */
export const PURGE_PER_WRITE = 50;

type C = Context<{ Bindings: Env }>;
const fail = (c: C, status: 400 | 403 | 404 | 405 | 413 | 429 | 503, error: string) => c.json({ error } satisfies ErrorResponse, status);

/** Reads at most `cap` bytes of a body; null when it is longer (the rest is never buffered). */
async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) out.set(chunk, (at += chunk.byteLength) - chunk.byteLength);
  return out;
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const inflate = (bytes: Uint8Array): Promise<Uint8Array | null> =>
  readCapped(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')), MAX_RAW_BYTES).catch(() => null);

/** REPLAY_API.idLength characters of the room alphabet, unbiased (rejection sampling). */
export function generateReplayId(): string {
  const n = ROOM_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let id = '';
  while (id.length < REPLAY_API.idLength) {
    for (const b of crypto.getRandomValues(new Uint8Array(REPLAY_API.idLength * 2))) {
      if (b < limit && id.length < REPLAY_API.idLength) id += ROOM_CODE_ALPHABET[b % n];
    }
  }
  return id;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Turnstile siteverify; false on any failure (fail closed). */
async function turnstileOk(secret: string, token: string, ip: string | undefined): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}

const r = new Hono<{ Bindings: Env }>();

r.post(API.replays, async (c) => {
  // The switch: without the Turnstile secret, saving is off (labelled; fragment links still work).
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return c.json({ error: 'not_configured', message: 'Bu sunucuda tekrar kaydı etkin değil.' }, 503);
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY_BYTES) return fail(c, 413, 'too_large');
  const raw = await readCapped(c.req.raw.body, MAX_BODY_BYTES);
  if (!raw) return fail(c, 413, 'too_large');

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw));
  } catch {
    return fail(c, 400, 'bad_request');
  }
  const parsed = replaySaveSchema.safeParse(json);
  if (!parsed.success) return fail(c, 400, 'bad_request');
  const { token, data } = parsed.data;
  if (data.length > MAX_DATA_CHARS) return fail(c, 413, 'too_large');
  const blob = fromBase64Url(data);
  if (!blob || blob.length === 0) return fail(c, 400, 'bad_replay');
  if (blob.length > REPLAY_API.maxBytes) return fail(c, 413, 'too_large');
  const bytes = await inflate(blob);
  const replay = bytes ? decodeReplay(bytes) : null;
  const seconds = replay ? replay.header.ticks / SIM_HZ : Infinity;
  if (!replay || seconds > REPLAY_LIMITS.maxSeconds) return fail(c, 400, 'bad_replay');

  const ip = c.req.header('cf-connecting-ip');
  const verdict = await c.env.LIMITER.getByName('replays').admit({
    rules: [{ key: ip ?? 'unknown', limit: REPLAY_API.perMinute }],
    windowMs: 60_000,
    budget: REPLAY_API.perDay,
  });
  if (verdict === 'busy') return fail(c, 429, 'busy');
  if (verdict === 'rules') return fail(c, 503, 'daily_cap');
  if (!(await turnstileOk(secret, token, ip))) return fail(c, 403, 'turnstile');

  const now = Date.now();
  const expiresAt = now + REPLAY_API.ttlMs;
  const hash = await sha256Hex(blob);
  const db = c.env.REPLAYS;
  const { header } = replay;
  try {
    const results = await db.batch<{ id: string; expires_at: number }>([
      db.prepare('DELETE FROM replays WHERE id IN (SELECT id FROM replays WHERE expires_at <= ?1 LIMIT ?2)').bind(now, PURGE_PER_WRITE),
      // Same bytes saved again: one row, its link lives another 30 days.
      db
        .prepare(
          `INSERT INTO replays (id, created_at, expires_at, sim_version, vehicle, suspension, seconds, bytes, sha256, data)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT(sha256) DO UPDATE SET expires_at = excluded.expires_at`,
        )
        .bind(generateReplayId(), now, expiresAt, header.simVersion, header.vehicleId, header.suspensionId, seconds, blob.length, hash, blob),
      db.prepare('SELECT id, expires_at FROM replays WHERE sha256 = ?1').bind(hash),
    ]);
    const row = results[2]?.results[0];
    if (!row) throw new Error('replay row missing after insert');
    return c.json({ id: row.id, expiresAt: row.expires_at } satisfies ReplaySaveResponse, 201);
  } catch (err) {
    // Storage full, daily D1 limits or an outage: labelled, the client offers a fragment link when it fits.
    console.error(err);
    return fail(c, 503, 'storage_unavailable');
  }
});
r.all(API.replays, (c) => fail(c, 405, 'method_not_allowed'));

r.get(`${API.replays}/:id`, async (c) => {
  const id = c.req.param('id');
  if (!REPLAY_ID.test(id)) return fail(c, 404, 'not_found');
  const row = await c.env.REPLAYS.prepare('SELECT data, created_at, expires_at FROM replays WHERE id = ?1 AND expires_at > ?2')
    .bind(id, Date.now())
    .first<{ data: ArrayBuffer | number[]; created_at: number; expires_at: number }>();
  if (!row) return fail(c, 404, 'not_found');
  const body: ReplayGetResponse = { data: toBase64Url(new Uint8Array(row.data)), createdAt: row.created_at, expiresAt: row.expires_at };
  // Immutable content behind an unguessable id: short public caching is safe.
  return c.json(body, 200, { 'Cache-Control': 'public, max-age=300' });
});

export default r;
