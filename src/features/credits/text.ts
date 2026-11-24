/** Attribution text for manifest entries (TASL: title, author, source, licence; CC BY also "changes indicated"). */
import type { Attribution } from '../../contracts/app';

const LICENSE_NAMES: Readonly<Record<string, string>> = {
  'CC-BY-4.0': 'CC BY 4.0',
  'CC0-1.0': 'CC0 1.0',
};

export const licenseName = (spdx: string): string => LICENSE_NAMES[spdx] ?? spdx;

/** One sentence per entry; for CC BY this is the exact form of ARCHITECTURE §15. */
export function attributionText(a: Attribution): string {
  const who = a.authorUrl ? `${a.author} (${a.authorUrl})` : a.author;
  const verb = a.license.startsWith('CC0') ? 'koşullarıyla kamu malı olarak sunulmuştur' : 'koşullarıyla lisanslanmıştır';
  const modified = a.modified ? ` Değişiklikler: ${a.modified.replace(/\.?$/, '.')}` : '';
  return `"${a.title}" — ${who}. ${licenseName(a.license)} (${a.licenseUrl}) ${verb}. Kaynak: ${a.sourceUrl}.${modified}`;
}
