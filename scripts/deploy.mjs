// Run after the production build. npm run deploy -- --dry-run forwards flags to the local Wrangler CLI.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig } from 'wrangler';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

class DeploymentConfigError extends Error {}
const requireConfig = (condition, message) => {
  if (!condition) throw new DeploymentConfigError(message);
};

/** Validate local resource selection without logging account IDs, database IDs, or credentials. */
function deploymentConfig() {
  const localPath = join(root, 'wrangler.local.jsonc');
  requireConfig(existsSync(localPath), 'Create ignored wrangler.local.jsonc with your existing account and resource IDs before deploying.');
  const { rawConfig: local } = experimental_readRawConfig({ config: localPath }, { useRedirectIfAvailable: false, hideWarnings: true });
  requireConfig(typeof local.account_id === 'string' && /^(?!0{32}$)[a-f0-9]{32}$/i.test(local.account_id), 'The local deployment config needs a valid account_id.');
  const databases = local.d1_databases ?? [];
  const validId = (id) => typeof id === 'string' && /^(?!00000000-0000-0000-0000-000000000000$)[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
  requireConfig(databases.some((db) => db.binding === 'REPLAYS') && databases.every((db) => validId(db.database_id)), 'The local deployment config needs existing D1 database IDs; automatic provisioning is disabled by this helper.');
  requireConfig(local.ai?.binding === 'AI' && ['ROOM', 'LIMITER'].every((name) => local.durable_objects?.bindings?.some((binding) => binding.name === name)), 'The local deployment config is missing required AI or Durable Object bindings.');

  const redirectPath = join(root, '.wrangler', 'deploy', 'config.json');
  requireConfig(existsSync(redirectPath), 'Build with the local deployment config before deploying.');
  const redirect = JSON.parse(readFileSync(redirectPath, 'utf8'));
  requireConfig(typeof redirect.configPath === 'string', 'The build deploy redirect is incomplete; rebuild first.');
  const builtPath = resolve(dirname(redirectPath), redirect.configPath);
  requireConfig(relative(root, builtPath).startsWith(`dist${sep}`) && existsSync(builtPath), 'The deploy redirect must point to an existing production build in dist.');
  const built = JSON.parse(readFileSync(builtPath, 'utf8'));
  const sourcePath = built.userConfigPath ?? built.configPath;
  requireConfig(typeof sourcePath === 'string' && resolve(root, sourcePath) === localPath, 'The build used the generic config, not wrangler.local.jsonc; rebuild first.');
  const ids = (config) => JSON.stringify((config.d1_databases ?? []).map((db) => [db.binding, db.database_id]).sort());
  requireConfig(built.name === local.name && built.account_id === local.account_id && ids(built) === ids(local), 'The build account, Worker or D1 selection differs from the local deployment config; rebuild first.');
  requireConfig(built.assets?.binding === 'ASSETS' && typeof built.assets.directory === 'string' && existsSync(resolve(dirname(builtPath), built.assets.directory)), 'The production assets are missing; rebuild first.');
  return builtPath;
}

try {
  const args = process.argv.slice(2);
  requireConfig(!args.some((arg) => /^(?:--(?:config|env|name)(?:=|$)|-[ce])/.test(arg)), 'Do not override config, environment or Worker name; update the local config and rebuild instead.');
  const builtPath = deploymentConfig();
  const revision = git('rev-parse', '--short=12', 'HEAD');
  const dirty = git('status', '--porcelain', '--untracked-files=normal').length > 0;
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const version = `${revision}${dirty ? '-dirty' : ''}-${timestamp}`;
  console.log(`Deploying APP_VERSION=${version}`);

  // Use the same Node executable as this helper and no shell, so Windows paths and arguments stay intact.
  const child = spawn(process.execPath, [
    join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'deploy', '--config', builtPath, '--var', `APP_VERSION:${version}`, ...args,
  ], { cwd: root, stdio: 'inherit' });
  child.once('error', (error) => {
    console.error(`Could not start Wrangler: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1);
  });
} catch (error) {
  console.error(error instanceof DeploymentConfigError ? error.message : 'Could not read deployment preparation. Check the local config, production build and Git repository.');
  process.exitCode = 1;
}
