import { Hono } from 'hono';
import { buildEngineerTools, ENGINEER_MAX_ACTIONS, type EngineerAction, type EngineerRequest, type EngineerResponse } from '../../src/contracts/engineer';
import { API } from '../../src/contracts/net';
import { CAR_CORNERS, MOTO_CORNERS } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { ruleAnswer } from '../engineer/fallback';
import { cleanText, runEngineerModel } from '../engineer/model';
import { ungroundedNumbers } from '../engineer/numbers';
import { buildMessages } from '../engineer/prompt';
import { engineerRequestSchema, parseAction, type ActionIds } from '../schemas/engineer';

/** Request body cap: a full request (question, telemetry, 6 history turns) is well under this. */
export const ENGINEER_MAX_BYTES = 8192;
// Motorcycle preset ids (ARCHITECTURE §7.1); the content arrives with phase 5.
const MOTO_SUSPENSIONS = ['moto-classic', 'moto-modern', 'moto-telelever'];
const SECTION_IDS = provingLoop.segments.map((s) => s.id);

function idsFor(vehicleClass: 'car' | 'motorcycle'): ActionIds {
  return vehicleClass === 'car'
    ? { suspensions: gtCoupe.suspensions, sections: SECTION_IDS, corners: CAR_CORNERS }
    : { suspensions: MOTO_SUSPENSIONS, sections: SECTION_IDS, corners: MOTO_CORNERS };
}

const DRIVE_TOOLS: ReadonlySet<string> = new Set(['set_view', 'highlight_component']);

/** The suggestion chips are commands: their effect must not depend on an optional model tool call. */
function requestsSlowMotion(question: string): boolean {
  const q = question.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').trim().replace(/[.!?]+$/, '').trim().replace(/\s+/g, ' ');
  return /^(?:lutfen,? )?(?:tumsegi )?agir cekimde goster(?:ir misin)?(?:,? lutfen)?$/.test(q)
    || /^(?:(?:can|could) you )?(?:please,? )?(?:show (?:(?:it|this|the bump) )?in slow motion|slow (?:it|this) down)(?:,? please)?$/.test(q);
}

export type EngineerOutcome = 'model' | 'no-model' | 'model-error' | 'empty' | 'ungrounded';

/** Pure post-processing of one request: model call (if any) -> clean text, validated actions, number check. */
export async function answer(req: EngineerRequest, ai: Ai | undefined): Promise<{ body: EngineerResponse; outcome: EngineerOutcome; detail?: string }> {
  const t = req.telemetry;
  const section = provingLoop.segments.find((s) => s.id === t.section);
  const driving = t.drive !== undefined;
  // While driving, `section` may name a proving-ground station (12-03) instead of a loop section.
  const station = driving ? provingGround.stations.find((s) => s.id === t.section) : undefined;
  const ids = idsFor(t.vehicle_class);
  const requestedSlowMotion = !driving && requestsSlowMotion(req.question) ? parseAction('set_slow_motion', { scale: 0.25 }, ids) : null;
  // Reserve the first action for this explicit request, even if the model omits tools or AI is unavailable.
  const actions: EngineerAction[] = requestedSlowMotion ? [requestedSlowMotion] : [];
  const fallback = (): EngineerResponse => ({ text: ruleAnswer(req.question, section?.phenomenon, t), actions, source: 'fallback' });
  if (!ai) return { body: fallback(), outcome: 'no-model' };
  // While driving only the camera and the glow are offered: a seek, a suspension swap or slow motion would take the
  // car out of the visitor's hands (live evaluation: unasked swaps and slow motion mid-drive). The client re-checks.
  const tools = buildEngineerTools(ids).filter((tool) => !driving || DRIVE_TOOLS.has(tool.function.name));
  let run;
  try {
    run = await runEngineerModel(ai, buildMessages(req, section, station), tools);
  } catch (e) {
    return { body: fallback(), outcome: 'model-error', detail: e instanceof Error ? e.message : String(e) };
  }
  for (const call of run.reply.toolCalls) {
    // A model-selected scale (including normal speed) must not override the visitor's slow-motion command.
    if (requestedSlowMotion && call.name === 'set_slow_motion') continue;
    const a = driving && !DRIVE_TOOLS.has(call.name) ? null : parseAction(call.name, call.args, ids);
    if (a && actions.length < ENGINEER_MAX_ACTIONS && !actions.some((b) => JSON.stringify(b) === JSON.stringify(a))) actions.push(a);
  }
  const text = cleanText(run.reply.text);
  if (!text) return { body: fallback(), outcome: 'empty', detail: run.model };
  const bad = ungroundedNumbers(text, t);
  if (bad.length > 0) return { body: fallback(), outcome: 'ungrounded', detail: `${run.model}: ${bad.join(',')}` };
  return { body: { text, actions, source: 'model' }, outcome: 'model', detail: run.model };
}

/**
 * Global limits, counted in the `engineer` Limiter Durable Object for every request (valid or not): per anonymous
 * client id (a venue behind one NAT is not throttled as one visitor) and per address (bounds id rotation), plus a
 * UTC-day admission budget for model-backed requests. This counts requests, not tokens or neurons: prompt lengths,
 * fallback model attempts and other users of this account can consume the free allocation sooner. It is not a
 * billing cap. Workers Free's provider-enforced quota is the no-overage protection; keep the account on Free.
 * Past this application's admission budget every answer is the labelled rule-based one.
 */
export const ENGINEER_LIMITS = { client: 6, ip: 40, windowMs: 60_000, dailyModelCalls: 280 } as const;

export type Admission = 'busy' | 'rules' | 'model';

async function admit(env: Env, clientKey: string, ip: string, needsModel: boolean): Promise<Admission> {
  if (!env.LIMITER) return 'model';
  const rules = clientKey === ip ? [{ key: ip, limit: ENGINEER_LIMITS.client }] : [{ key: clientKey, limit: ENGINEER_LIMITS.client }, { key: ip, limit: ENGINEER_LIMITS.ip }];
  try {
    const budget = needsModel ? { budget: ENGINEER_LIMITS.dailyModelCalls } : {};
    return await env.LIMITER.getByName('engineer').admit({ rules, windowMs: ENGINEER_LIMITS.windowMs, ...budget });
  } catch (e) {
    // Limiter unreachable: answer from the rules rather than spend model calls unmetered.
    console.error('limiter', e instanceof Error ? e.message : e);
    return 'rules';
  }
}

const r = new Hono<{ Bindings: Env }>();

r.post(API.engineer, async (c) => {
  const noStore = { 'Cache-Control': 'no-store' };
  if (Number(c.req.header('content-length') ?? 0) > ENGINEER_MAX_BYTES) return c.json({ error: 'too_big' }, 413, noStore);
  const raw = await c.req.text();
  if (raw.length > ENGINEER_MAX_BYTES) return c.json({ error: 'too_big' }, 413, noStore);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: 'bad_request' }, 400, noStore);
  }
  const parsed = engineerRequestSchema.safeParse(json);

  // The address is only a key inside the limiter's one-minute window; it is never stored or logged.
  const clientId = c.req.header('x-client-id');
  const ip = `ip:${c.req.header('cf-connecting-ip') ?? 'anon'}`;
  const clientKey = clientId && /^[\w-]{8,64}$/.test(clientId) ? `c:${clientId}` : ip;
  const admission = await admit(c.env, clientKey, ip, parsed.success);
  if (admission === 'busy') return c.json({ error: 'busy' }, 429, noStore);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400, noStore);

  // Cast only for exactOptionalPropertyTypes: zod types optional corners as `X | undefined` (absent at runtime).
  const req = parsed.data as EngineerRequest;
  c.env.STATS?.writeDataPoint({ indexes: ['engineer-asked'], blobs: ['engineer-asked', req.telemetry.suspension, ''], doubles: [1] });
  const started = Date.now();
  const { body, outcome, detail } = await answer(req, admission === 'model' ? c.env.AI : undefined);
  // Never log the question text: outcome, model and timing only.
  console.log(JSON.stringify({ engineer: admission === 'rules' ? 'budget' : outcome, detail, ms: Date.now() - started, actions: body.actions.length }));
  return c.json(body, 200, noStore);
});

export default r;
