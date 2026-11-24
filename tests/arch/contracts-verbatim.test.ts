/** Frozen files equal their ARCHITECTURE blocks byte for byte: M1 §5/§9.1/§12.1/§12.2, superseded by the
 * M2 addendum's C<n> (contracts), F<n> (registration) and, from plan 12-01, W<n> (worker) blocks. */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const m1 = read('.planning/ARCHITECTURE.md');
const m2 = read('.planning/ARCHITECTURE-M2.md');

/** First fenced block of `lang` after the heading line that starts with `heading`. */
function blockAfter(md: string, heading: string, lang: string): string {
  const start = md.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const open = md.indexOf(`\n\`\`\`${lang}\n`, start);
  const close = md.indexOf('\n```\n', open + 1);
  return `${md.slice(open + lang.length + 5, close)}\n`;
}

interface Block { readonly doc: string; readonly heading: string; readonly path: string; readonly lang: string }
/** Block kinds of the addendum that are live: 'CF' from 08-01; 12-01 changes it to 'CFW'. */
const M2_KINDS = 'CFW';
const m2Blocks: Block[] = [...m2.matchAll(/^### ([A-Z])(\d+) `([^`]+)`$/gm)]
  .filter((m) => M2_KINDS.includes(m[1]!))
  .map((m) => ({ doc: m2, heading: `### ${m[1]!}${m[2]!} `, path: m[3]!, lang: m[3]!.endsWith('.jsonc') ? 'jsonc' : 'ts' }));
const m1Contracts = [...m1.matchAll(/^### (5\.\d+) `([^`]+)`$/gm)];
const m1Blocks: Block[] = [
  ...m1Contracts.map((m) => ({ doc: m1, heading: `### ${m[1]!} `, path: m[2]!, lang: 'ts' })),
  { doc: m1, heading: '### 9.1 ', path: 'src/app/features.ts', lang: 'ts' },
  { doc: m1, heading: '### 12.1 ', path: 'wrangler.jsonc', lang: 'jsonc' },
  { doc: m1, heading: '### 12.2 ', path: 'worker/index.ts', lang: 'ts' },
];
const blocks = [...m1Blocks.filter((b) => !m2Blocks.some((n) => n.path === b.path)), ...m2Blocks];
const CONTRACTS = ['units', 'suspension', 'vehicle', 'track', 'telemetry', 'sim', 'events', 'store', 'app', 'services', 'net', 'engineer', 'drive', 'world'];

describe('contracts verbatim', () => {
  it('finds the twelve M1 contract blocks', () => expect(m1Contracts).toHaveLength(12));

  it('has exactly the fourteen contract files, each with a block', () => {
    const files = readdirSync(new URL('src/contracts/', root)).filter((f) => f.endsWith('.ts')).sort();
    expect(files).toEqual(CONTRACTS.map((n) => `${n}.ts`).sort());
    for (const n of CONTRACTS) expect(blocks.some((b) => b.path === `src/contracts/${n}.ts`)).toBe(true);
  });

  it.each(blocks)('$path equals its block ($heading)', ({ doc, heading, path, lang }) => {
    expect(read(path)).toBe(blockAfter(doc, heading, lang));
  });

  it('registers 29 features, each pointing at an existing folder', () => {
    const lines = [...read('src/app/features.ts').matchAll(/^export \{ default as \w+ \} from '\.\.\/features\/([a-z-]+)\/index';$/gm)];
    expect(lines).toHaveLength(29);
    for (const [, id] of lines) expect(read(`src/features/${id}/index.ts`)).toContain(`id: '${id}'`);
  });
});
