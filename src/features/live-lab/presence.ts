/** Pure helpers for the presence readout and the room connection URL. */
import { PROTOCOL_VERSION, WS_PREFIX, type RoomRole } from '../../contracts/net';

export interface Segment {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** 0..1 of everyone who reported a pick. */
  readonly share: number;
  readonly mine: boolean;
}

/**
 * Distribution keys are `${vehicleId}:${suspensionId}` (contracts/store.ts RoomStatus.dist).
 * Sorted by count (desc), then label, so the bar does not jitter between equal counts.
 */
export function segments(dist: Readonly<Record<string, number>>, mineKey: string, labelOf: (suspensionId: string) => string): Segment[] {
  let total = 0;
  const out: { key: string; label: string; count: number }[] = [];
  for (const [key, count] of Object.entries(dist)) {
    if (!(count > 0)) continue;
    total += count;
    out.push({ key, label: labelOf(key.slice(key.indexOf(':') + 1)), count });
  }
  return out
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((s) => ({ ...s, share: s.count / total, mine: s.key === mineKey }));
}

export const watchingText = (viewers: number): string => `Laboratuvarda ${viewers} kişi`;

export interface ConnectParams {
  readonly origin: string;
  readonly code: string;
  readonly id: string;
  readonly role: RoomRole;
  readonly vehicleId: string;
  readonly suspensionId: string;
}

/** `wss://host/ws/<CODE>?id=&role=&v=&s=&pv=` (contracts/net.ts; never a key: hosts authenticate in a frame). */
export function socketUrl(p: ConnectParams): string {
  const url = new URL(`${WS_PREFIX}${p.code}`, p.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('id', p.id);
  url.searchParams.set('role', p.role);
  url.searchParams.set('v', p.vehicleId);
  url.searchParams.set('s', p.suspensionId);
  url.searchParams.set('pv', String(PROTOCOL_VERSION));
  return url.toString();
}

/** 44xx/45xx are final room decisions (bad version, forbidden, unknown room, full): do not hammer the server. */
export const isFinalClose = (code: number): boolean => code >= 4400 && code < 4600;
export const UNKNOWN_ROOM_CLOSE = 4404;
