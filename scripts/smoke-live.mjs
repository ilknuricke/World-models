// Live smoke (ARCHITECTURE §13): node scripts/smoke-live.mjs [baseUrl]
// Exits 1 if any check fails. Works against production or a local `vite preview`.
const target = process.argv[2] ?? process.env.SMOKE_BASE_URL;
if (!target) throw new Error('Pass a base URL or set SMOKE_BASE_URL (for example, http://localhost:4173).');
const base = target.replace(/\/$/, '');
let failed = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name} — ${err instanceof Error ? err.message : err}`);
  }
}

async function get(path) {
  const res = await fetch(base + path, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (res.status !== 200) throw new Error(`${path} returned ${res.status}`);
  return res;
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log(`smoke-live: ${base}`);

await check('GET / serves the app shell', async () => {
  const html = await (await get('/')).text();
  assert(/id=["']stage["']/.test(html), 'HTML has no #stage element');
});

await check('GET /api/health', async () => {
  const res = await get('/api/health');
  const body = await res.json();
  assert(body.ok === true, `ok is ${body.ok}`);
  assert(typeof body.version === 'string' && body.version.length > 0, 'version missing');
  assert(res.headers.get('cache-control')?.includes('no-store'), 'missing Cache-Control: no-store');
  return `version ${body.version}`;
});

await check('GET /api/time within 5 s of local clock', async () => {
  const t0 = Date.now();
  const { t } = await (await get('/api/time')).json();
  const t1 = Date.now();
  const skew = t - (t0 + t1) / 2;
  assert(typeof t === 'number' && Math.abs(skew) < 5000, `skew ${skew} ms`);
  return `skew ${Math.round(skew)} ms, rtt ${t1 - t0} ms`;
});

let manifest;
await check('GET /asset-manifest.json', async () => {
  manifest = await (await get('/asset-manifest.json')).json();
  return `${Object.keys(manifest.assets ?? {}).length} assets, ${(manifest.attributions ?? []).length} attributions`;
});

await check('first manifest asset is served immutable', async () => {
  const first = Object.values(manifest?.assets ?? {})[0];
  assert(first, 'manifest has no assets');
  const res = await get(first.url);
  await res.arrayBuffer();
  assert(res.headers.get('cache-control')?.includes('immutable'), `Cache-Control is "${res.headers.get('cache-control')}"`);
  return first.url;
});

console.log(failed ? `smoke-live: ${failed} check(s) FAILED` : 'smoke-live: all checks passed');
process.exit(failed ? 1 : 0);
