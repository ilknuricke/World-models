// Optional bindings and secrets. Set secrets with `npx wrangler secret put <NAME>`; never store their values here.
// Routes that require a missing secret answer a labelled 501/503.
interface Env {
  /** Optional account-level usage analytics; the public app also runs without this binding. */
  readonly STATS?: AnalyticsEngineDataset;
  /** Turnstile widget secret for POST /api/replays (12-01). Unset => saving is not enabled (503 not_configured). */
  readonly TURNSTILE_SECRET?: string;
  /** Analytics Engine SQL API token for GET /api/insight (12-06, stretch). */
  readonly AE_SQL_TOKEN?: string;
}
