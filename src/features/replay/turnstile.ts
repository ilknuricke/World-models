/**
 * Cloudflare Turnstile for saving replays (ARCHITECTURE-M2 §12.1, plan 12-05). The script is loaded only when a visitor
 * chooses to save (never on page load). The public site key is configured at build time; on a local host
 * (vite dev / preview, e2e) Cloudflare's documented test keys are used instead, `?turnstile=pass|fail` picks one there.
 * The switch cannot bypass anything: the server verifies every token with its own secret, and the production secret
 * rejects the dummy tokens the test keys produce.
 */

/** Public widget identifier from ignored local deployment settings; never put the verification secret here. */
export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? '';
/** Cloudflare's test site keys (developers.cloudflare.com/turnstile/troubleshooting/testing). */
export const TEST_SITE_KEYS = {
  pass: '1x00000000000000000000AA',
  fail: '2x00000000000000000000AB',
} as const;
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** The script gets this long to load before the check counts as unavailable, ms. */
export const LOAD_TIMEOUT_MS = 15_000;

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function siteKeyFor(loc: { readonly hostname: string; readonly search: string }, publicSiteKey = SITE_KEY): string {
  if (!LOCAL.has(loc.hostname)) return publicSiteKey;
  return new URLSearchParams(loc.search).get('turnstile') === 'fail' ? TEST_SITE_KEYS.fail : TEST_SITE_KEYS.pass;
}

/** The part of the Turnstile API used here. */
export interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
}

let loading: Promise<TurnstileApi> | null = null;

/** Loads api.js once (a failed load is retried on the next call). */
export function loadTurnstile(timeoutMs = LOAD_TIMEOUT_MS): Promise<TurnstileApi> {
  const ready = (globalThis as { turnstile?: TurnstileApi }).turnstile;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error('turnstile unavailable'));
    };
    const timer = setTimeout(fail, timeoutMs);
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      const api = (globalThis as { turnstile?: TurnstileApi }).turnstile;
      if (!api) return fail();
      clearTimeout(timer);
      resolve(api);
    };
    document.head.append(script);
  });
  return loading;
}

export type ChallengeOutcome = { readonly token: string } | { readonly error: 'challenge' | 'unavailable' | 'expired' };

/**
 * Renders one widget into `host` and settles once: a token, or why there is none. `dispose()` removes the widget
 * (call it when the popover closes or the save ends).
 */
export function challenge(host: HTMLElement, siteKey: string, onOutcome: (o: ChallengeOutcome) => void): { dispose(): void } {
  let id: string | undefined;
  let api: TurnstileApi | undefined;
  let done = false;
  let disposed = false;
  const settle = (o: ChallengeOutcome) => {
    if (done || disposed) return;
    done = true;
    onOutcome(o);
  };
  loadTurnstile().then(
    (t) => {
      if (disposed) return;
      api = t;
      try {
        id = t.render(host, {
          sitekey: siteKey,
          action: 'replay-save',
          theme: 'dark',
          language: 'tr',
          size: 'flexible',
          retry: 'never',
          'refresh-expired': 'never',
          callback: (token: string) => settle({ token }),
          'error-callback': () => {
            settle({ error: 'challenge' });
            return true; // handled: no console error from the widget
          },
          'expired-callback': () => settle({ error: 'expired' }),
          'timeout-callback': () => settle({ error: 'expired' }),
          'unsupported-callback': () => settle({ error: 'unavailable' }),
        });
      } catch {
        settle({ error: 'unavailable' });
      }
    },
    () => settle({ error: 'unavailable' }),
  );
  return {
    dispose() {
      disposed = true;
      if (api && id !== undefined) {
        try {
          api.remove(id);
        } catch {
          // already gone
        }
      }
      host.replaceChildren();
    },
  };
}
