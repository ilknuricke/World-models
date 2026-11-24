/** Credits (CRED-01): attribution text and the CREDITS.md mirror of the in-app panel. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Attribution } from '../../src/contracts/app';
import { APACHE_2_0, CODE_CREDITS, LICENSE_NOTICES, LICENSE_TEXTS, STDLIB_ATTRIBUTION, STDLIB_NOTICE } from '../../src/features/credits/code-credits';
import { attributionText } from '../../src/features/credits/text';

const attributions = JSON.parse(readFileSync('assets-src/ATTRIBUTION.json', 'utf8')) as Attribution[];
const md = readFileSync('CREDITS.md', 'utf8').replace(/\r\n/g, '\n');
const DB11 =
  '"Aston Martin db11" — Black Snow (https://sketchfab.com/BlackSnow02). CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/) koşullarıyla lisanslanmıştır. Kaynak: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7. Değişiklikler: optimize edildi ve sıkıştırıldı (meshopt), çokgen sayısı azaltıldı, malzemeler yenilendi, logolar gizlendi.';

describe('attributionText', () => {
  it('produces the exact DB11 CC BY text (ARCHITECTURE §15)', () => {
    const db11 = attributions.find((a) => a.license === 'CC-BY-4.0');
    expect(db11 && attributionText(db11)).toBe(DB11);
  });

  it('names title, author, licence and source for every CC0 entry', () => {
    for (const a of attributions.filter((x) => x.license === 'CC0-1.0')) {
      const t = attributionText(a);
      expect(t).toContain(`"${a.title}" — ${a.author}`);
      expect(t).toContain('CC0 1.0');
      expect(t).toContain(a.sourceUrl);
    }
  });
});

describe('CREDITS.md mirrors the panel', () => {
  it('contains the exact DB11 text', () => expect(md).toContain(DB11));

  it.each(attributions.map((a) => [a.title, a] as const))('lists asset "%s"', (_t, a) => {
    expect(md).toContain(`"${a.title}"`);
    expect(md).toContain(a.author);
    expect(md).toContain(a.sourceUrl);
  });

  it.each(CODE_CREDITS.map((k) => [k.name, k] as const))('lists code credit %s with licence and copyright', (_n, k) => {
    expect(md).toContain(`| [${k.name}](${k.url}) | ${k.use} | ${k.license} | ${k.copyright} |`);
  });

  it('reproduces the full BSD-3 notice and the MIT permission text', () => {
    expect(md).toContain(LICENSE_TEXTS['BSD-3-Clause']);
    expect(md).toContain(LICENSE_TEXTS.MIT);
  });

  it.each(LICENSE_NOTICES.map((n) => [n.title, n.text] as const))('reproduces the notice "%s" in full', (_t, text) => {
    expect(md).toContain(text);
  });
});

describe('M2 lifted code (13-01, MD-62)', () => {
  const names = CODE_CREDITS.map((k) => k.name);
  it('credits every lift and idea the M2 summaries list', () => {
    for (const n of ['stdlib-js', 'Go math (exp)', 'fdlibm (FreeBSD msun)', 'Project Chrono', 'Jolt Physics', 'Godot-Easy-Vehicle-Physics', 'ArcadeCarPhysics', 'PythonRobotics', 'folio-2025', 'V8']) expect(names).toContain(n);
  });
  it('Apache-2.0: the full licence, the NOTICE line, the changes, the Sun and Go notices', () => {
    expect(APACHE_2_0).toMatch(/^\s*Apache License\n\s*Version 2\.0, January 2004/);
    expect(APACHE_2_0).toMatch(/END OF TERMS AND CONDITIONS$/);
    expect(APACHE_2_0.length).toBeGreaterThan(9000);
    expect(STDLIB_NOTICE).toContain('Copyright (c) 2016-2026 The Stdlib Authors.');
    expect(STDLIB_NOTICE).toMatch(/Changes made in Suspension Lab/);
    expect(STDLIB_ATTRIBUTION).toContain('Permission to use, copy, modify, and distribute this\nsoftware is freely granted, provided that this notice\nis preserved.');
    expect(STDLIB_ATTRIBUTION).toContain('Copyright (c) 2009 The Go Authors. All rights reserved.');
    expect(STDLIB_ATTRIBUTION).toContain('Neither the name of Google Inc. nor the names of its');
    // the source keeps its notice too
    const det = readFileSync('src/sim-core/math/det.ts', 'utf8');
    expect(det).toContain('Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice');
    expect(det).toContain('SPDX-License-Identifier: Apache-2.0');
    expect(det).toMatch(/Modified \(Apache-2\.0 §4\(b\)\)/);
  });
});

