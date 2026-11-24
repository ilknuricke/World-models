// Engineer rate-limit proof (07-02): node scripts/smoke-engineer-limit.mjs [baseUrl] [--model]
// Limits are counted in one Limiter Durable Object for every request, valid or not, so this uses schema-invalid
// bodies (400, no model call, no neurons). With --model, the first request is a real question (1 model call).
// Prints the colo of every response (cf-ray suffix) to show the burst was spread and still counted once.
// Exits 1 unless request client+1 (per client id) is the first 429. The per-address check is informational: it
// only holds when every request leaves from one source address (a rotating egress proxy spreads them).
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? process.env.SMOKE_BASE_URL;
if (!target) throw new Error('Pass a base URL or set SMOKE_BASE_URL (for example, http://localhost:4173).');
const base = target.replace(/\/$/, '');
const withModel = args.includes('--model');
const LIMITS = { client: 6, ip: 40 }; // worker/routes/engineer.ts ENGINEER_LIMITS
const run = `${process.pid}-${Date.now().toString(36)}`;
const colos = new Map();

const telemetry = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../tests/fixtures/06-02-telemetry-carousel.json', import.meta.url), 'utf8'));

async function ask(clientId, body) {
  const res = await fetch(`${base}/api/engineer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-id': clientId },
    body: JSON.stringify(body),
  });
  const colo = res.headers.get('cf-ray')?.split('-')[1] ?? 'local';
  colos.set(colo, (colos.get(colo) ?? 0) + 1);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const invalid = { question: '' };

let failed = 0;
const report = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

// 1. Per client id: requests 1..6 pass the limiter (200 model / 400 invalid), request 7 is 429.
const c1 = `limit-proof-${run}`;
const statuses = [];
let ipHits = 0;
for (let i = 0; i < LIMITS.client + 1; i++) {
  const r = await ask(c1, withModel && i === 0 ? { question: 'Why is the outside front wheel leaning like that?', telemetry, history: [] } : invalid);
  ipHits++;
  statuses.push(r.status === 200 ? `200 ${r.json?.source}` : String(r.status));
}
report(
  statuses.slice(0, LIMITS.client).every((s) => !s.startsWith('429')) && statuses[LIMITS.client] === '429',
  `per client id: ${LIMITS.client} allowed, request ${LIMITS.client + 1} limited — [${statuses.join(', ')}]`,
);

// 1b. A concurrent burst from a second client id (lands on several isolates at once): exactly `client` get through.
const burst = await Promise.all(Array.from({ length: LIMITS.client + 4 }, () => ask(`limit-burst-${run}`, invalid)));
ipHits += burst.length;
const passed = burst.filter((r) => r.status !== 429).length;
report(passed === LIMITS.client, `concurrent burst of ${burst.length} from one client id: ${passed} passed, ${burst.length - passed} limited`);

// 2. Per address: rotate client ids (each under its own limit); the address's request ip+1 is the first 429.
let firstBusy = null;
while (ipHits < LIMITS.ip + 1) {
  const r = await ask(`limit-proof-${run}-${ipHits}`, invalid);
  ipHits++;
  if (r.status === 429 && firstBusy === null) firstBusy = ipHits;
}
// Informational only: an egress proxy that rotates source addresses spreads these over several keys.
console.log(`${firstBusy === LIMITS.ip + 1 ? 'ok  ' : 'info'} per address with rotating client ids: first 429 at request ${firstBusy ?? 'none'} (${LIMITS.ip + 1} if every request left from one address)`);
console.log(`     colos: ${[...colos].map(([c, n]) => `${c}×${n}`).join(' ')}`);
console.log(failed ? `engineer-limit: ${failed} check(s) failed` : 'engineer-limit: all checks passed');
process.exit(failed ? 1 : 0);
