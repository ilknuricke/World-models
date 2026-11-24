# Suspension Lab — event run-sheet

For showing Suspension Lab at a live technology event: a booth screen visitors drive, a presenter remote, a phone
driver and an audience poll. Set your deployment URL in the ignored `.env.local` file as `SMOKE_BASE_URL`;
check that URL's `/api/health` endpoint for the deployed version. No account-specific deployment URL is stored here.

**Read the last section first.** Several things have never been tried on real hardware.

---

## 1. Before the day

Keep existing deployment files intact. On a fresh clone, copy `wrangler.jsonc` to the ignored
`wrangler.local.jsonc` and `.env.example` to the ignored `.env.local`. In the local Wrangler config, set your
`account_id` and the `REPLAYS` binding's existing `database_id`; preserve the Worker name and binding names.
In `.env.local`, set `VITE_TURNSTILE_SITE_KEY` to your widget's public site key and `SMOKE_BASE_URL` to your
deployment URL. Keep `TURNSTILE_SECRET` in the Worker's secrets, never in a `VITE_` variable. Vite selects the
local Wrangler config automatically. `npm run deploy` builds and validates that config before deploying;
`npm run deploy -- --dry-run` validates without publishing. Apply D1 migrations with
`npx wrangler d1 migrations apply suspension-lab-replays --remote --config wrangler.local.jsonc`.

| When | What | Why |
|---|---|---|
| 2 weeks | **Confirm Workers Free** and review the daily limits (§5). | Phone driving and a busy room use Durable Object requests: about 6.7k metered requests per hour of phone driving at 30 Hz. If a Free quota is exhausted, affected features stop until the quota resets at 00:00 UTC. The engineer has a 280-request daily model budget and then provides rule-based answers; that counter does not measure neurons or guarantee a billing cap. Keep the account on Free for this deployment. |
| 2 weeks | **Custom domain?** Only if you need it. | On a custom domain you must (1) add that exact host's `wss://` origin to `connect-src` in `public/_headers`; the existing dynamic header rule covers workers.dev hosts; (2) add the host to your Turnstile widget (dashboard → Turnstile), or server saves fail; (3) redeploy. QR codes follow `location.origin`, so they need no change. |
| 1 week | **Run it on the actual booth machine and GPU**, at the venue resolution. | Every look and frame-rate judgement so far was made under SwiftShader (software rendering in a headless browser). Pick `?quality=` by eye: the adaptive governor starts from a guess. Check the premium look in Auto, close-up and driving, and the annex (ride street, pad, braking platform). |
| 1 week | **Listen to the audio** (press M; it is muted by default). | Engine, tyre and road sounds were tuned on paper and unit-tested only. Nobody has listened to them. |
| 1 week | **Try the input devices for real:** keyboard, a standard gamepad (triggers, stick, A/X/Y, rumble), a touch screen. | Gamepad and touch were only tested with mocked or synthetic input. |
| Day before, at the venue | **Phone driver on the venue Wi-Fi.** Pair a phone from the booth screen's QR and drive for 2 minutes. Note the link badge colours and the phone's round trip (badge on both). Amber means > 150 ms, red > 250 ms. Write the measured values here: ______ ms | Measured so far only on one machine here: phone input → screen p50 19 ms on a local server; the production relay added about 17 ms (p50) from a cloud container. Venue Wi-Fi and real phones are untested, and so is tilt (try it on iOS Safari and Android Chrome). |
| Day before | **One real replay save on production.** Drive > 60 s, Share → "Save the whole run", solve the check, open the `#rid=` link on another device. | A production save needs a human to solve Turnstile; it has never been done. Saving was proven only with Cloudflare's test keys against a local worker. |
| Day before | `npm run smoke:live` and `node --env-file-if-exists=.env.local scripts/smoke-room.mjs` | Read the target from `SMOKE_BASE_URL`; an explicit URL argument overrides it. Checks health, assets, rooms, driver role and relay latency. |
| Morning | Open the booth page, check `/api/health`, set the browser to fullscreen (F11 / kiosk), mute OS notifications, disable sleep. | — |

---

## 2. URLs and flags

| What | URL / key |
|---|---|
| Booth / presenter screen | `/?screen=1` (creates a private room, shows the presenter QR, then the audience QR; idle hand-back ×2.5 = 30 s) |
| Presenter remote (phone) | scan the warn-tinted presenter QR on the screen (`/remote.html?room=CODE#k=KEY`; the key stays in the fragment) |
| Audience (phones) | the audience QR, or `/r/CODE` (room codes are short codes shown on the screen) |
| Phone driver | the "Drive from your phone" card on the `?screen=1` screen: its QR is `/remote.html?room=CODE#d=KEY`. One phone drives at a time; the newest pairing wins and the older phone shows "replaced" |
| Audience poll | presenter remote → Poll → open ("Which suspension should we run next?") → close → "Run <winner>" |
| Join a private room as a viewer | `/?room=CODE` |
| Quality | `?quality=low` / `medium` / `high` (default: adaptive) |
| Start driving at a station | `?drive=manual&spawn=steering-pad` (also `ride-street`, `slalom`, `lane-change`, `braking-platform`) |
| Attract mode | starts after **30 s** without input in Auto (`?attract=0` off, `?attract=1` force); any key ends it |
| Driving idle | Manual hands back after **12 s** without input (**30 s** with `?screen=1`), with a 3-2-1 cue; after a drive, Auto re-syncs to the live lap after **20 s** idle |
| Keys | ↑/W take the wheel · Enter hand back · R reset (Manual) · Q moment replay · G Compare · 1/2/3 suspension · F/E/C follow/explore/close-up · X x-ray · S slow motion · A amplification (Auto) · H hide HUD · M sound · Space pause · ? help |

---

## 3. Five-minute demo script

| Time | Do | Say (no numbers you have not just read off the screen) |
|---|---|---|
| 0:00 | Auto lap, follow view. | "The same car on the same lap; only the suspension geometry changes. Every number is computed live." |
| 0:40 | Press **2** (double wishbone), then **3** (multi-link). | "Same bump, different wheel motion: watch camber and toe in the card." |
| 1:20 | **C** close-up over the bump strip, **X** if needed. | "This is the linkage moving: the model solves it every step." |
| 2:00 | **↑** take the wheel, drive a corner, press **Q** after a slide. | "Now the visitor drives exactly that car. The coach explains what the simulator detected." |
| 2:40 | Stations (pin icon) → **Steering pad**. Drive a circle. | "Experiments, not a race: what does the car need to hold this circle?" |
| 3:20 | **G** Compare. | "The same autopilot drives your line with another suspension. The panel says if the difference is bigger than the autopilot's own repeat error, and says so when there is none." |
| 4:00 | **Enter** to hand back (Returning), or let idle hand it back. | "It drives itself back to the lap." |
| 4:20 | Hand a phone the driver QR; the visitor presses Gas. | "The phone is the steering wheel; the physics runs here." |
| 4:45 | Presenter remote → open the poll → close → "Run <winner>". | "The room decides what we look at next." |

Honesty lines to keep: the car is a representative model, not a real car's data; assists are a simplified model;
the strut and the double wishbone drive almost the same in this model; no suspension type is best overall.

---

## 4. When something fails

| Symptom | What it is | Do |
|---|---|---|
| Engineer answers say "Rule-based answer" | Daily AI cap (280 model calls/UTC day), a model timeout (≈ 1 in 5 driving answers hit the 9 s timeout in testing) or no network | Nothing; rule answers are correct and labelled. Resets 00:00 UTC. |
| Engineer says it is busy (429) | Per-visitor (6/min) or per-address (40/min) limit | Wait a minute. A venue NAT shares the 40/min address limit. |
| Screen card shows no QR / "room ended" | The room is gone (rooms expire 12 h after the last socket closes) or the Worker hit a Free-plan cap | Reload `/?screen=1`: it creates a new room; re-pair the phones. |
| Phone shows "This driving code has expired" | Room recreated, or an old QR | Scan the current screen QR again. |
| Phone shows "replaced" | Another phone paired (newest wins) | "Take the wheel back" on the phone, or let the other visitor drive. |
| Phone lost / pocketed / out of Wi-Fi | No input frames | Automatic: inputs fade to neutral after 250 ms, the car returns to the lap after 1 s, the screen shows "Phone controller lost". |
| Low frame rate | GPU too weak for the tier | Reload with `?quality=medium` or `?quality=low`; keep the HUD on (it costs little). |
| Car stuck, odd, or "Reset to road" note | The plant restored itself repeatedly and reset the car | R resets to the line; Enter hands back. |
| "Back inside the proving ground" | Left the drivable area | Automatic reset to the nearest station or the line. |
| Share link says "recorded with an older model" | The link predates the deployed model | It still plays; the label is correct. |
| Save says "The check did not pass" | Turnstile failed (or a custom domain is missing from the widget) | The `#r=` link above it still shares the last minute. See §1, custom domain. |
| Network gone entirely | — | Auto, Manual, stations, replays (moment replay, `#r=` links already open) work offline; rooms, phone driver, engineer AI, server saves do not. |

**Rollback:** `npx wrangler deployments list --config wrangler.local.jsonc`, then
`npx wrangler rollback <version-id> --config wrangler.local.jsonc`. **Stop saving runs:**
`npx wrangler secret delete TURNSTILE_SECRET --config wrangler.local.jsonc` (saves answer a labelled 503; links still work).

---

## 5. Free-tier limits that matter (per account, reset 00:00 UTC)

| Resource | Free limit | What uses it | Notes |
|---|---|---|---|
| Worker requests | 100k / day | API calls, room joins, asset requests that reach the Worker | A booth alone uses little; a large audience joining rooms adds up. |
| Durable Object requests | 100k / day (WebSocket messages billed 20:1) | Rooms, phone driver, engineer limiter | 1 h of phone driving ≈ 6.7k billed requests; 1 h of audience room traffic is small (coalesced ≤ 1 Hz). |
| DO duration | 13,000 GB-s / day | Awake rooms | A streaming room ≈ 450 GB-s per hour. |
| Workers AI | 10,000 neurons / day | Engineer answers | Token length and fallback attempts vary. The 280-request budget does not guarantee staying below the neuron quota. On Workers Free the provider rejects usage above its free quota. |
| D1 rows written | 100k / day | Saved replays (≈ 4 rows per save) | Saves capped at 2,000/day and 5/min per address. |
| D1 storage | 500 MB | Saved replays (30-day expiry) | Typical run 0.4–11 KB. |

---

## 6. Switching features off quickly

Per device, with URL flags. No deploy is needed, and the app boots clean with any of them; this is covered by
`tests/e2e/13-01-matrix.spec.ts`.

| Flag | Removes |
|---|---|
| `?features=-drive` | Manual driving (Auto only; also removes the phone driver) |
| `-phone-drive` | the phone-driver card and pairing |
| `-proving-ground` | the annex (rendering and physics); the loop stays drivable |
| `-coach` · `-tyre-vfx` · `-replay` · `-ghost-lab` | coach lines · grip rings and skid marks · replays and share links · Compare |
| `-engineer` · `-live-lab` · `-poll` · `-presenter` | the engineer · rooms (and poll, presenter, phone driver) · the poll · the presenter QR/remote |
| `-audio` · `-attract` · `-analytics` | sound · attract mode · anonymous analytics |

Combine with commas: `?screen=1&features=-ghost-lab,-coach`.

---

## 7. NOT verified on real hardware (do these before relying on them)

- Frame rate, the look (colours, AA, wet surfaces, the annex, skid marks, friction rings, the ghost) and the driving
  camera tuning on a real GPU: everything was judged under SwiftShader only.
- Audio: never listened to (engine, tyre cue, road noise; muted by default).
- Gamepad (mapping, dead zones, rumble): only mocked. Touch driving: only synthetic CDP touch.
- Phone tilt steering, the iOS motion-permission flow, haptics: only synthetic sensor events. The phone driver's
  latency has not been measured on venue Wi-Fi or real phones.
- A real production replay save (needs a human to solve Turnstile).
- Cross-browser determinism: replays and share links are checked bit-exact between Node and Chromium only; in
  Firefox or Safari a replay may drift, and the player then labels it "approximate from here".
