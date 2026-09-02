#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArtifact, normalizeAgentDojo, normalizeBipia, normalizeDolly, readRegistry, sha256, writeRelease } from './dataset-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0] ?? 'list';
const sourceId = args[1];
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const limit = Math.max(1, Math.min(15_000, Number(option('--limit', '200'))));

function fail(message) { console.error(`SentinelForge dataset error: ${message}`); process.exitCode = 1; }

const registry = await readRegistry(root);
const source = registry.sources.find((item) => item.id === sourceId);

if (command === 'list') {
  console.table(registry.sources.map(({ id, name, lane, integration, status, revision }) => ({ id, name, lane, integration, status, revision })));
} else if (command === 'inspect') {
  if (!source) fail(`Unknown source '${sourceId}'. Run 'npm run dataset -- list'.`);
  else console.log(JSON.stringify({ ...source, default_enabled: false, network_required: source.integration === 'direct_import', import_executes_code: false, activation_after_import: false }, null, 2));
} else if (command === 'import') {
  if (!source) fail(`Unknown source '${sourceId}'.`);
  else if (source.integration === 'manifest_only') fail(`${source.name} is manifest-only until its licence/provenance review and immutable pin are supplied.`);
  else if (source.integration !== 'direct_import') fail(`${source.name} uses '${source.integration}'. Use the adapt command.`);
  else if (!flag('--accept-license')) fail('Explicit --accept-license is required; acceptance is recorded only for this local import job.');
  else {
    const localFiles = args.flatMap((value, index) => value === '--local' && args[index + 1] ? [args[index + 1]] : []);
    if (!localFiles.length && !flag('--network')) fail('Network access is disabled by default. Add --network or provide --local once per required artifact.');
    else {
      const jobId = `${source.id}-${Date.now()}`;
      const quarantine = path.join(root, '.sentinelforge', 'quarantine', jobId);
      await mkdir(quarantine, { recursive: true });
      const imported = [];
      const contents = [];
      for (let index = 0; index < source.artifacts.length; index += 1) {
        const artifact = source.artifacts[index];
        const local = localFiles[index];
        if (local) {
          if (!existsSync(local)) throw new Error(`Local artifact not found: ${local}`);
          const bytes = await readFile(local);
          if (bytes.length > artifact.max_bytes) throw new Error(`Local artifact exceeds ${artifact.max_bytes} bytes`);
          const actual = sha256(bytes);
          if (actual !== artifact.sha256) throw new Error(`Checksum mismatch for ${artifact.name}: expected ${artifact.sha256}, got ${actual}`);
          await writeFile(path.join(quarantine, artifact.name), bytes, { flag: 'wx' });
          contents.push(bytes.toString('utf8'));
          imported.push({ name: artifact.name, mode: 'local', sha256: actual, bytes: bytes.length });
        } else {
          const fetched = await fetchArtifact(artifact, path.join(quarantine, artifact.name));
          contents.push(fetched.bytes.toString('utf8'));
          imported.push({ name: artifact.name, mode: 'network', sha256: fetched.sha256, bytes: fetched.bytes.length });
        }
      }
      const cases = source.id === 'databricks-dolly-15k' ? normalizeDolly(contents[0], source, limit) : normalizeBipia(contents[0], contents[1], source, limit);
      const { releaseDir, manifest } = await writeRelease(root, source, cases, imported);
      console.log(JSON.stringify({ import_job: jobId, release_id: manifest.release_id, cases: cases.length, status: manifest.status, activation_allowed: false, release_dir: path.relative(root, releaseDir) }, null, 2));
    }
  }
} else if (command === 'adapt') {
  if (!source) fail(`Unknown source '${sourceId}'.`);
  else if (source.integration !== 'result_adapter') fail(`${source.name} does not use a result adapter.`);
  else {
    const input = option('--input');
    if (!input || !existsSync(input)) fail('Provide an existing recorded result file with --input. SentinelForge will not execute the benchmark.');
    else {
      const cases = normalizeAgentDojo(await readFile(input, 'utf8'), source, limit);
      const { releaseDir, manifest } = await writeRelease(root, source, cases, [{ name: path.basename(input), mode: 'recorded_results' }]);
      console.log(JSON.stringify({ release_id: manifest.release_id, cases: cases.length, status: manifest.status, release_dir: path.relative(root, releaseDir) }, null, 2));
    }
  }
} else {
  fail(`Unknown command '${command}'. Use list, inspect, import, or adapt.`);
}
