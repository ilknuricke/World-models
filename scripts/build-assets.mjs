// Asset pipeline (ARCHITECTURE §11): assets-src/** -> public/assets/** (content-hashed) + public/asset-manifest.json.
// Usage: node scripts/build-assets.mjs   (also exported as buildAssets() for tests)
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const MiB = 1024 * 1024;
export const MAX_FILE_BYTES = 24 * MiB;
export const INITIAL_SET_WARN_BYTES = 12e6;
const ATTRIBUTION_FILE = 'ATTRIBUTION.json';
/** Vehicle nodes the runtime regroups into hubs: each must survive optimisation at least 4 times (one per corner). */
const REQUIRED_CORNER_NODES = [/wheel/i, /caliper/i, /brakedisc/i];
const isInitial = (id) => id === 'car/aston-martin-db11' || id === 'hdri/derelict_airfield_01_1k' || id.startsWith('textures/asphalt_track/');
const REQUIRED_FIELDS = ['title', 'author', 'license', 'licenseUrl', 'sourceUrl'];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const toPosix = (p) => p.split(sep).join('/');

/** @param {unknown} data @param {string[]} files */
export function checkAttributions(data, files) {
  if (!Array.isArray(data)) throw new Error(`${ATTRIBUTION_FILE} must be an array of Attribution entries`);
  const covered = new Set();
  for (const [i, a] of data.entries()) {
    for (const k of REQUIRED_FIELDS) {
      if (typeof a?.[k] !== 'string' || !a[k]) throw new Error(`${ATTRIBUTION_FILE}[${i}] is missing "${k}"`);
    }
    if (!Array.isArray(a.files) || a.files.length === 0) throw new Error(`${ATTRIBUTION_FILE}[${i}] has no files`);
    for (const f of a.files) {
      if (!files.includes(f)) throw new Error(`${ATTRIBUTION_FILE}[${i}] lists "${f}", which is not in assets-src`);
      covered.add(f);
    }
  }
  const missing = files.filter((f) => !covered.has(f));
  if (missing.length) throw new Error(`No attribution entry for: ${missing.join(', ')}`);
  return /** @type {import('../src/contracts/app').Attribution[]} */ (data);
}

async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

const nodeNames = (doc) => doc.getRoot().listNodes().map((n) => n.getName()).filter(Boolean);

/** Keep named pivots/bones and skinned attributes intact. Never flatten/join/palette/simplify/instance/weld:
 *  they merge or drop nodes needed for wheel articulation and skeletal posing. */
async function optimiseGlb(io, bytes, label) {
  const doc = await io.readBinary(bytes);
  const before = nodeNames(doc);
  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: doc.getRoot().listSkins().length > 0 }));
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const out = await io.writeBinary(doc);

  // Re-read the written file: proves it parses (with meshopt) and that the hierarchy survived.
  const after = new Set(nodeNames(await io.readBinary(out)));
  const lost = before.filter((n) => !after.has(n));
  if (lost.length) throw new Error(`${label}: optimisation dropped named nodes: ${lost.slice(0, 10).join(', ')}`);
  if (label.startsWith('car/')) {
    for (const re of REQUIRED_CORNER_NODES) {
      const n = [...after].filter((name) => re.test(name)).length;
      if (n < 4) throw new Error(`${label}: expected >= 4 nodes matching ${re}, found ${n}`);
    }
  }
  return out;
}

/**
 * @param {{ srcDir?: string, outDir?: string, log?: (msg: string) => void }} [opts]
 * @returns {Promise<import('../src/contracts/app').AssetManifest>}
 */
export async function buildAssets(opts = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const srcDir = opts.srcDir ?? join(root, 'assets-src');
  const outDir = opts.outDir ?? join(root, 'public');
  const log = opts.log ?? console.log;
  const assetsDir = join(outDir, 'assets');
  const manifestPath = join(outDir, 'asset-manifest.json');

  await rm(assetsDir, { recursive: true, force: true });
  await rm(manifestPath, { force: true });

  const files = (await walk(srcDir)).map((p) => toPosix(relative(srcDir, p))).filter((f) => f !== ATTRIBUTION_FILE).sort();
  const attributions = checkAttributions(JSON.parse(await readFile(join(srcDir, ATTRIBUTION_FILE), 'utf8')), files);

  let io;
  /** @type {Record<string, import('../src/contracts/app').AssetEntry>} */
  const assets = {};
  for (const file of files) {
    const ext = extname(file);
    const id = file.slice(0, -ext.length);
    let bytes = new Uint8Array(await readFile(join(srcDir, file)));
    if (ext === '.glb') bytes = await optimiseGlb((io ??= await createIO()), bytes, file);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`${file}: ${bytes.byteLength} bytes exceeds the ${MAX_FILE_BYTES}-byte per-file limit (Workers Static Assets: 25 MiB)`);
    }
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const rel = `${id}.${hash}${ext}`;
    await mkdir(dirname(join(assetsDir, rel)), { recursive: true });
    await writeFile(join(assetsDir, rel), bytes);
    assets[id] = { id, url: `/assets/${rel}`, bytes: bytes.byteLength };
  }

  /** @type {import('../src/contracts/app').AssetManifest} */
  const manifest = { version: 1, assets, attributions };
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const entries = Object.values(assets);
  const total = entries.reduce((s, a) => s + a.bytes, 0);
  const initial = entries.filter((a) => isInitial(a.id)).reduce((s, a) => s + a.bytes, 0);
  for (const a of entries) log(`  ${(a.bytes / MiB).toFixed(2).padStart(6)} MiB  ${a.url}`);
  log(`build-assets: ${entries.length} assets, ${(total / MiB).toFixed(2)} MiB total, initial set ${(initial / 1e6).toFixed(2)} MB, ${attributions.length} attributions`);
  if (initial > INITIAL_SET_WARN_BYTES) log(`WARN build-assets: initial set ${(initial / 1e6).toFixed(2)} MB exceeds 12 MB`);
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await buildAssets();
  } catch (err) {
    console.error(`build-assets FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
