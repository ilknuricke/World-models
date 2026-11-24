// Room smoke (ARCHITECTURE §12.4): node scripts/smoke-room.mjs [baseUrl] [--load N] [--drive-s S] [--drive-hz HZ]
// Exercises the real Durable Object over WebSockets: presence + distribution, picks, clock sync, host ctl,
// poll/vote, validation, close codes, the phone driver (ARCHITECTURE-M2 §12.2: pairing, a HZ stream for S seconds
// with relay latency, audience isolation, telemetry, takeover), and optionally N concurrent sockets.
// Exits 1 if any check fails.
// Uses private rooms (exact counts); LIVE is only checked for connectivity because real visitors may be there.
const args = process.argv.slice(2);
const loadIdx = args.indexOf('--load');
const load = loadIdx >= 0 ? Number(args[loadIdx + 1]) : 0;
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const driveS = opt('--drive-s', 30);
const driveHz = opt('--drive-hz', 60);
const isValue = (i) => i > 0 && ['--load', '--drive-s', '--drive-hz'].includes(args[i - 1]);
const target = args.find((a, i) => !a.startsWith('--') && !isValue(i)) ?? process.env.SMOKE_BASE_URL;
if (!target) throw new Error('Pass a base URL or set SMOKE_BASE_URL (for example, http://localhost:4173).');
const base = target.replace(/\/$/, '');
const wsBase = base.replace(/^http/, 'ws');
const PV = 3; // PROTOCOL_VERSION (src/contracts/net.ts)
const LAP_S = 83.72; // proving loop lap (02-04); only used to express clock error as lap time
const V = 'gt-coupe';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name} — ${err instanceof Error ? err.message : err}`);
  }
}

let nextId = 0;
const uid = () => `smoke-${process.pid}-${nextId++}`;

/** Opens a room socket; resolves after the welcome (or rejects with the close code). */
function client(code, { role = 'viewer', s, k, pv = PV, id = uid() } = {}) {
  const q = new URLSearchParams({ id, role, pv: String(pv) });
  if (s) q.set('v', V), q.set('s', s);
  const ws = new WebSocket(`${wsBase}/ws/${code}?${q}`);
  // A host's or driver's key never goes in the URL: it is the first frame after every open (protocol 2+).
  if (k) ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'auth', k })));
  const messages = [];
  const waiters = new Set();
  const c = {
    ws,
    id,
    messages,
    closed: null,
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    last: (t) => messages.filter((m) => m.t === t).at(-1),
    waitFor(pred, ms = 8000, what = 'message') {
      const hit = messages.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.add(w);
        setTimeout(() => {
          waiters.delete(w);
          reject(new Error(`timeout waiting for ${what} (last: ${JSON.stringify(messages.at(-1))})`));
        }, ms);
      });
    },
    /** Like waitFor, but only messages arriving after now. */
    next(pred, ms, what) {
      const start = messages.length;
      return c.waitFor((m) => messages.indexOf(m) >= start && pred(m), ms, what);
    },
    close: () => ws.close(1000),
  };
  c.done = new Promise((resolve) =>
    ws.addEventListener('close', (e) => {
      c.closed = { code: e.code, reason: e.reason };
      resolve(c.closed);
    }),
  );
  ws.addEventListener('message', (e) => {
    if (typeof e.data !== 'string' || e.data[0] !== '{') return;
    const m = JSON.parse(e.data);
    m.at = performance.now();
    messages.push(m);
    for (const w of [...waiters]) if (w.pred(m)) waiters.delete(w), w.resolve(m);
  });
  c.ready = Promise.race([
    c.waitFor((m) => m.t === 'welcome', 10_000, 'welcome'),
    c.done.then((cl) => Promise.reject(new Error(`closed ${cl.code} ${cl.reason}`))),
  ]).then(() => c);
  c.ready.catch(() => {}); // callers that expect a rejection await `done` instead
  return c;
}

async function createRoom() {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
  assert(res.status === 200, `POST /api/rooms -> ${res.status}`);
  return res.json();
}

/** NTP-style offset (same maths as src/features/live-lab/time-sync.ts): mean offset of the 3 lowest-RTT probes. */
async function wsOffset(c, n = 8) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const c0 = performance.now();
    c.send({ t: 'sync', c0 });
    const m = await c.next((x) => x.t === 'sync' && x.c0 === c0, 5000, 'sync');
    const rtt = m.at - c0;
    samples.push({ rtt, offset: m.s1 - (Date.now() - (performance.now() - m.at) - rtt / 2) });
    await new Promise((r) => setTimeout(r, 150));
  }
  const best = samples.sort((a, b) => a.rtt - b.rtt).slice(0, 3);
  return { offset: best.reduce((s, x) => s + x.offset, 0) / best.length, rtt: best[0].rtt };
}

async function httpOffset(n = 5) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const c0 = performance.now();
    const { t } = await (await fetch(`${base}/api/time`, { cache: 'no-store' })).json();
    const rtt = performance.now() - c0;
    samples.push({ rtt, offset: t - (Date.now() - rtt / 2) });
  }
  const best = samples.sort((a, b) => a.rtt - b.rtt)[0];
  return best;
}

const presence = (c, pred, what) => c.waitFor((m) => (m.t === 'presence' || m.t === 'welcome') && pred(m.t === 'welcome' ? m.presence : m), 8000, what);
const fmtDist = (d) => JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, n]) => [k.split(':')[1], n])));

console.log(`smoke-room: ${base}${load ? ` (load ${load})` : ''}`);

await check('HTTP routes: /r/:code 302, /ws bad code 404, /ws without upgrade 426', async () => {
  const r = await fetch(`${base}/r/ab2cd`, { redirect: 'manual' });
  assert(r.status === 302 && r.headers.get('location')?.endsWith('/remote.html?room=AB2CD'), `/r -> ${r.status} ${r.headers.get('location')}`);
  assert((await fetch(`${base}/ws/NOPE1`)).status === 404, 'bad code not 404');
  assert((await fetch(`${base}/ws/LIVE`)).status === 426, 'no upgrade not 426');
});

await check('LIVE room: welcome + sync over the public room', async () => {
  const c = await client('LIVE', { s: 'double-wishbone' }).ready;
  const w = c.last('welcome');
  c.send({ t: 'sync', c0: 1 });
  const s = await c.next((m) => m.t === 'sync', 5000, 'sync');
  c.close();
  return `${w.presence.viewers} in the lab, s1 ${s.s1}`;
});

const room = await createRoom().catch((e) => (console.log(`FAIL POST /api/rooms — ${e.message}`), failed++, null));

if (room) {
  console.log(`     room ${room.code}`);
  let v1;
  let v2;
  await check('two viewers: presence 2 with their suspension distribution', async () => {
    v1 = await client(room.code, { s: 'macpherson' }).ready;
    v2 = await client(room.code, { s: 'multilink' }).ready;
    const want = (p) => p.viewers === 2 && p.dist[`${V}:macpherson`] === 1 && p.dist[`${V}:multilink`] === 1;
    const [p1] = await Promise.all([presence(v1, want, 'presence 2 on v1'), presence(v2, want, 'presence 2 on v2')]);
    return `viewers ${p1.viewers ?? p1.presence.viewers} ${fmtDist(p1.dist ?? p1.presence.dist)}`;
  });

  await check('pick: suspension change reaches the other viewer (coalesced, <= 1 Hz)', async () => {
    const t0 = performance.now();
    v2.send({ t: 'pick', vehicleId: V, suspensionId: 'double-wishbone' });
    const p = await v1.next((m) => m.t === 'presence' && m.dist[`${V}:double-wishbone`] === 1 && !m.dist[`${V}:multilink`], 5000, 'presence after pick');
    return `${fmtDist(p.dist)} after ${Math.round(p.at - t0)} ms`;
  });

  await check('clock sync: WS offset agrees with /api/time and between clients (same lap point)', async () => {
    const [a, b] = [await wsOffset(v1), await wsOffset(v2)];
    const h = await httpOffset();
    const diff = Math.abs(a.offset - b.offset);
    assert(diff < 50, `clients disagree by ${diff.toFixed(1)} ms`);
    assert(Math.abs(a.offset - h.offset) < Math.max(100, h.rtt), `WS vs HTTP offset ${a.offset.toFixed(1)} vs ${h.offset.toFixed(1)} ms`);
    const lapDiff = diff / 1000;
    assert(lapDiff < 0.15, `lap time difference ${lapDiff}`);
    return `offset ${a.offset.toFixed(1)} / ${b.offset.toFixed(1)} ms (http ${h.offset.toFixed(1)}), min RTT ${a.rtt.toFixed(0)} ms, lap-time diff ${(lapDiff * 1000).toFixed(1)} ms of ${LAP_S} s`;
  });

  await check('host: key in the first frame (wrong key 4401), viewer ctl forbidden, host ctl reaches the screen with seq', async () => {
    const bad = client(room.code, { role: 'host', k: 'x'.repeat(32) });
    const cl = await bad.done;
    assert(cl.code === 4401, `wrong key closed ${cl.code}`);
    const screen = await client(room.code, { role: 'screen', s: 'double-wishbone' }).ready;
    const host = await client(room.code, { role: 'host', k: room.hostKey }).ready;
    v1.send({ t: 'ctl', set: { xray: true } });
    await v1.next((m) => m.t === 'err' && m.code === 'forbidden', 5000, 'err forbidden');
    host.send({ t: 'ctl', set: { suspensionId: 'multilink', xray: true } });
    const ctl = await screen.next((m) => m.t === 'ctl', 5000, 'ctl');
    assert(ctl.state.seq === 1 && ctl.state.xray === true && ctl.state.suspensionId === 'multilink', JSON.stringify(ctl));
    host.send({ t: 'cue', cue: 'focus-car' });
    const cue = await screen.next((m) => m.t === 'cue', 5000, 'cue');
    // host is not counted as a viewer but is signalled: v1, v2, screen + 1 host
    await presence(v1, (p) => p.viewers === 3 && p.hosts === 1, 'presence 3 + 1 host');
    globalThis.host = host;
    globalThis.screen = screen;
    return `ctl seq ${ctl.state.seq}, cue seq ${cue.seq}, viewers 3 (host excluded), hosts 1`;
  });

  await check('poll: host opens, audience votes once each (re-vote replaces), tally broadcast, close, clear', async () => {
    const { host } = globalThis;
    const a1 = await client(room.code, { role: 'audience' }).ready;
    const a2 = await client(room.code, { role: 'audience' }).ready;
    host.send({ t: 'poll', poll: { question: 'Which handles the kerb best?', options: ['MacPherson', 'Wishbone', 'Multi-link'] } });
    const opened = (await a1.next((m) => m.t === 'poll' && m.poll?.open, 5000, 'poll open')).poll;
    a1.send({ t: 'vote', pollId: opened.id, choice: 0 });
    a1.send({ t: 'vote', pollId: opened.id, choice: 1 });
    a2.send({ t: 'vote', pollId: opened.id, choice: 1 });
    const t = await host.waitFor((m) => m.t === 'poll' && m.poll?.counts.join() === '0,2,0', 5000, 'tally 0,2,0');
    host.send({ t: 'poll', poll: null });
    const closed = await a2.next((m) => m.t === 'poll' && m.poll && !m.poll.open, 5000, 'poll closed');
    host.send({ t: 'poll', poll: null });
    await a2.next((m) => m.t === 'poll' && m.poll === null, 5000, 'poll cleared');
    a1.close();
    a2.close();
    return `counts ${t.poll.counts.join('/')}, closed with ${closed.poll.counts.join('/')}, then cleared`;
  });

  await check('validation: bad message -> err, oversize -> 1009, flooding -> err rate', async () => {
    v1.send('{"t":"pick","vehicleId":"<b>"}');
    await v1.next((m) => m.t === 'err' && m.code === 'bad-message', 5000, 'err bad-message');
    for (let i = 0; i < 25; i++) v2.send({ t: 'sync', c0: -i });
    await v2.waitFor((m) => m.t === 'err' && m.code === 'rate', 5000, 'err rate');
    const big = await client(room.code).ready;
    big.send({ t: 'sync', c0: 1, pad: 'x'.repeat(2000) });
    const cl = await big.done;
    assert(cl.code === 1009, `oversize closed ${cl.code}`);
  });

  await check('protocol mismatch 4400, unknown private room 4404', async () => {
    const old = await client(room.code, { pv: 0 }).done;
    assert(old.code === 4400, `pv mismatch closed ${old.code}`);
    const unknown = await client('ZZZZ2').done;
    assert(unknown.code === 4404, `unknown room closed ${unknown.code}`);
  });

  await check('driver: wrong key / host key / LIVE -> 4401, pending `in` and viewer `in` forbidden, pairing -> presence drivers 1', async () => {
    assert(typeof room.driverKey === 'string' && room.driverKey.length === 32 && room.driverKey !== room.hostKey, 'POST /api/rooms has no distinct driverKey');
    const codes = await Promise.all([
      client(room.code, { role: 'driver', k: 'y'.repeat(32) }).done,
      client(room.code, { role: 'driver', k: room.hostKey }).done,
      client('LIVE', { role: 'driver', k: room.driverKey }).done,
    ]);
    assert(codes.every((c) => c.code === 4401), `closed ${codes.map((c) => c.code).join('/')}`);
    const unauth = client(room.code, { role: 'driver' });
    unauth.ws.addEventListener('open', () => unauth.send({ t: 'in', n: 0, s: 0, th: 0, br: 0, f: 1 }));
    await unauth.waitFor((m) => m.t === 'err' && m.code === 'forbidden', 5000, 'pending in forbidden');
    unauth.close();
    v1.send({ t: 'in', n: 0, s: 0, th: 0, br: 0, f: 1 });
    await v1.next((m) => m.t === 'err' && m.code === 'forbidden', 5000, 'viewer in forbidden');
    const driver = await client(room.code, { role: 'driver', k: room.driverKey }).ready;
    assert(driver.last('welcome').role === 'driver', 'welcome role');
    await presence(globalThis.screen, (p) => p.drivers === 1 && p.viewers === 3, 'presence drivers 1');
    globalThis.driver = driver;
    return `wrong/host/LIVE keys closed ${codes.map((c) => c.code).join('/')}; driver welcomed; presence viewers 3 + drivers 1`;
  });

  await check(`driver: ${driveHz} Hz for ${driveS} s reaches the screen whole; audience + viewer get 0 input frames; tel 5 Hz to the driver`, async () => {
    const { driver, screen } = globalThis;
    assert(driver, 'no driver');
    const audience = await client(room.code, { role: 'audience' }).ready;
    const total = Math.round(driveHz * driveS);
    const sentAt = new Float64Array(total);
    const screenStart = screen.messages.length;
    const driverStart = driver.messages.length;
    const t0 = performance.now();
    let telSent = 0;
    for (let n = 0; n < total; n++) {
      const due = t0 + (n * 1000) / driveHz;
      const wait = due - performance.now();
      if (wait > 1) await new Promise((r) => setTimeout(r, wait));
      sentAt[n] = performance.now();
      driver.send({ t: 'in', n, s: Math.round(Math.sin(n / 30) * 1000), th: 600, br: 0, f: 1 });
      if (n % Math.round(driveHz / 5) === 0) screen.send({ t: 'tel', v: n % 200, g: 3, m: 1, k: n % 4 }), telSent++;
    }
    const sendSpan = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 1500));
    const got = screen.messages.slice(screenStart).filter((m) => m.t === 'in');
    const lat = got.map((m) => m.at - sentAt[m.n]).sort((a, b) => a - b);
    const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
    const inOrder = got.every((m, i) => i === 0 || m.n > got[i - 1].n);
    const errs = driver.messages.slice(driverStart).filter((m) => m.t === 'err');
    const tel = driver.messages.slice(driverStart).filter((m) => m.t === 'tel').length;
    const leaked = [audience, v1, v2].map((c) => c.messages.filter((m) => m.t === 'in' || m.t === 'tel').length);
    audience.close();
    assert(got.length === total, `screen received ${got.length} of ${total}`);
    assert(inOrder, 'frames out of order');
    assert(errs.length === 0, `driver got ${JSON.stringify(errs[0])}`);
    assert(got.every((m) => typeof m.r === 'number'), 'relayed frame without r');
    assert(leaked.every((n) => n === 0), `audience/viewers received ${leaked.join('/')} drive frames`);
    assert(tel === telSent, `driver received ${tel} of ${telSent} tel`);
    globalThis.driveStats = { total, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: lat.at(-1), min: lat[0] };
    return `${got.length}/${total} delivered in order (sent over ${(sendSpan / 1000).toFixed(1)} s), relay driver->DO->screen min ${lat[0].toFixed(1)} / p50 ${q(0.5).toFixed(1)} / p95 ${q(0.95).toFixed(1)} / p99 ${q(0.99).toFixed(1)} / max ${lat.at(-1).toFixed(1)} ms; audience/viewers 0/0/0; tel ${tel}/${telSent}`;
  });

  await check('driver: a newer driver takes the wheel (older closed 4409), leaving -> presence drivers 0', async () => {
    const { driver, screen } = globalThis;
    const d2 = await client(room.code, { role: 'driver', k: room.driverKey }).ready;
    const old = await driver.done;
    assert(old.code === 4409, `older driver closed ${old.code}`);
    screen.send({ t: 'tel', v: 50, g: 2, m: 1, k: 0 });
    await d2.next((m) => m.t === 'tel' && m.v === 50, 5000, 'tel to the new driver');
    await presence(screen, (p) => p.drivers === 1, 'presence drivers 1');
    d2.close();
    await screen.next((m) => m.t === 'presence' && m.drivers === 0, 8000, 'presence drivers 0');
    return 'older driver 4409 replaced, tel follows the new driver, drivers 1 -> 0';
  });

  await check('leaving updates presence', async () => {
    globalThis.host.close();
    globalThis.screen.close();
    v2.close();
    const p = await v1.waitFor((m) => m.t === 'presence' && m.viewers === 1, 8000, 'presence 1');
    v1.close();
    return `viewers ${p.viewers}`;
  });
}

if (load > 0) {
  await check(`load: ${load} sockets in one room, one presence observer`, async () => {
    const r = await createRoom();
    const observer = await client(r.code, { s: 'macpherson' }).ready;
    const t0 = performance.now();
    const picks = ['macpherson', 'double-wishbone', 'multilink'];
    const sockets = [];
    for (let i = 0; i < load; i += 25) {
      const batch = [];
      for (let j = i; j < Math.min(load, i + 25); j++) batch.push(client(r.code, { s: picks[j % 3] }).ready);
      sockets.push(...(await Promise.all(batch)));
    }
    const joined = performance.now() - t0;
    const p = await observer.waitFor((m) => m.t === 'presence' && m.viewers === load + 1, 15_000, `presence ${load + 1}`);
    const presenceMsgs = observer.messages.filter((m) => m.t === 'presence').length;
    for (const s of sockets) s.close();
    await observer.waitFor((m) => m.t === 'presence' && m.viewers === 1, 15_000, 'presence back to 1');
    observer.close();
    return `${load} joined in ${Math.round(joined)} ms; dist ${fmtDist(p.dist)}; ${presenceMsgs} presence broadcasts during the join`;
  });
}

console.log(failed ? `smoke-room: ${failed} check(s) failed` : 'smoke-room: all checks passed');
// Let close frames flush.
setTimeout(() => process.exit(failed ? 1 : 0), 300);
