import { lstatSync, readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { AGENT, AGENT_SKILLS_ROOT, KYRO_MANIFEST_PATH, MACHINE_ADAPTER_REGISTRY_PATH, SCOPE } from '../constants';
import { buildCommandSkillManagedFiles, parseSkillRuntimeVersion } from '../adapters/command-skills';
import { readMachineAdapterRegistry, registerMachineAdapterPlan, withMachineAdapterRegistryLock } from '../adapters/machine-registry';
import { getAdapterDefinition, getInstallableAdapters } from '../adapters/registry';
import { setCliMachineResult } from '../core/cli-envelope';
import { KyroCoreError } from '../core/errors';
import { applyPlan, printPlan, resolveManagedPath } from '../fs';
import { printCommandHelp } from '../help';
import { buildRuntimeInstallPlan } from '../install-plan';
import { endMarker, startMarker } from '../injectors/managed-block';
import { mergeJsonObjectContent } from '../injectors/json-merge';
import { assertInstallableAgents, parseAgent, parseOptions } from '../options';
import { withStateWriterLock } from '../pipeline/state-writer-lock';
import { readManifest, readProjectState } from '../state';
import type { Agent, CliOptions, KyroManifest, OperationPlan } from '../types';

export function runAdaptersCommand(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) { printCommandHelp('adapters'); return; }
  const [mode = 'list', ...rest] = args;
  if (!['list', 'enable', 'disable'].includes(mode)) throw new KyroCoreError('INVALID_INPUT', `Unknown adapters subcommand: ${mode}.`, 'Run kyro adapters --help.');
  const rawAgent = mode === 'list' ? null : rest.shift();
  if (mode !== 'list' && (!rawAgent || rawAgent.startsWith('-'))) throw new KyroCoreError('INVALID_INPUT', `${mode} requires an adapter.`, `Implemented adapters: ${getInstallableAdapters().map((adapter) => adapter.agent).join(', ')}.`);
  const options = parseOptions(rest);
  const agent = rawAgent ? parseAgent(rawAgent) : null;
  if (agent) assertInstallableAgents([agent]);
  if (mode === 'list') { printAdapterList(); return; }
  if (agent === AGENT.STANDARD && mode === 'disable') throw new KyroCoreError('INVALID_INPUT', 'The canonical standard adapter cannot be disabled.', 'Use kyro uninstall --machine to remove Kyro-owned canonical skills.');
  assertRealRemovalParents(MACHINE_ADAPTER_REGISTRY_PATH);
  const mutate = (): void => {
    if (mode === 'enable') enableAdapter(agent!, options);
    else disableAdapter(agent!, options);
  };
  if (options.dryRun) mutate();
  else withStateWriterLock(() => withMachineAdapterRegistryLock(mutate));
}

function printAdapterList(): void {
  const registry = readMachineAdapterRegistry();
  const adapters = getInstallableAdapters().map((adapter) => {
    const entry = registry.adapters.find((entry) => entry.agent === adapter.agent);
    return {
      agent: adapter.agent,
      detected: adapter.agent === AGENT.STANDARD || adapter.detect({ homeDir: homedir(), envPath: process.env.PATH ?? '' }).installed,
      state: entry?.state ?? 'unregistered',
      projection: entry?.projection ?? null,
      integrations: entry?.integrations ?? false,
    };
  });
  setCliMachineResult('result', { adapters });
  for (const row of adapters) console.log(`${row.agent}: detected=${row.detected}; state=${row.state}; projection=${row.projection ?? 'none'}; integrations=${row.integrations}`);
}

function enableAdapter(agent: Agent, options: CliOptions): void {
  const plan = buildRuntimeInstallPlan(SCOPE.WORKSPACE, [agent], options.integrations);
  // Machine enable does not rewrite workspace state. An explicit integration opt-in
  // can publish the current workspace's instruction block if it is initialized.
  if (options.integrations && readProjectState()) {
    const integration: OperationPlan[] = [];
    getAdapterDefinition(agent).buildProjection(integration, { integrations: true, includeWorkspace: true });
    plan.push(...integration.filter((operation) => !operation.path.startsWith('~/')));
  }
  printPlan('Adapter enable plan', plan);
  if (!options.dryRun) applyPlan(plan);
  const registry = options.dryRun ? null : readMachineAdapterRegistry();
  setCliMachineResult(options.dryRun ? 'preview' : 'applied', { agent, state: 'enabled', projection: registry?.adapters.find((entry) => entry.agent === agent)?.projection ?? null, dryRun: options.dryRun, affectedFiles: plan.map((operation) => operation.path) });
  console.log(`Adapter ${agent}: enabled${options.dryRun ? ' (dry run)' : ''}.`);
}

function disableAdapter(agent: Agent, options: CliOptions): void {
  const registry = readMachineAdapterRegistry();
  const plan = buildMachineRemovalPlan([agent], false);
  const now = new Date().toISOString();
  const entry = registry.adapters.find((entry) => entry.agent === agent);
  if (entry) Object.assign(entry, { state: 'disabled', projection: null, integrations: false, updatedAt: now });
  else registry.adapters.push({ agent, state: 'disabled', projection: null, integrations: false, updatedAt: now });
  registry.adapters.sort((a, b) => a.agent.localeCompare(b.agent));
  registerMachineAdapterPlan(plan, registry);
  printPlan('Adapter disable plan', plan);
  if (!options.dryRun) applyPlan(plan);
  const note = `Canonical ${AGENT_SKILLS_ROOT} skills are preserved and remain visible to Codex, Pi, and OpenCode.`;
  setCliMachineResult(options.dryRun ? 'preview' : 'applied', { agent, state: 'disabled', projection: null, integrations: false, dryRun: options.dryRun, affectedFiles: [...plan.map((operation) => operation.path), MACHINE_ADAPTER_REGISTRY_PATH], note });
  console.log(`Adapter ${agent}: disabled${options.dryRun ? ' (dry run)' : ''}. ${note}`);
}

function statIfPresent(path: string): ReturnType<typeof lstatSync> | null {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

function foreign(path: string): never {
  throw new KyroCoreError('INVALID_INPUT', `Unsafe or foreign Kyro removal target: ${path}.`, 'Move the foreign path aside; Kyro removes only manifest-owned real files and links to the canonical skill of the same name.');
}

/** Check every ancestor before any read/removal, including dangling symlinks. */
export function assertRealRemovalParents(path: string): void {
  for (let current = dirname(resolveManagedPath(path)); ; current = dirname(current)) {
    const stat = statIfPresent(current);
    if (stat && !stat.isDirectory()) foreign(current);
    if (dirname(current) === current) break;
  }
}

function owns(manifest: KyroManifest | null, path: string): boolean {
  return manifest?.managedFiles.includes(path) === true || manifest?.managedFiles.includes(`${path}/SKILL.md`) === true;
}

function addSkillRemoval(plan: OperationPlan[], path: string, manifest: KyroManifest | null, canonical: boolean): void {
  assertRealRemovalParents(path);
  const absolute = resolveManagedPath(path);
  const stat = statIfPresent(absolute);
  if (!stat) return;
  if (!owns(manifest, path)) foreign(path);
  if (stat.isSymbolicLink()) {
    if (canonical || resolve(dirname(absolute), readlinkSync(absolute)) !== resolveManagedPath(`${AGENT_SKILLS_ROOT}/${path.split('/').at(-1)}`)) foreign(path);
  } else {
    if (!stat.isDirectory() || readdirSync(absolute).length !== 1 || readdirSync(absolute)[0] !== 'SKILL.md') foreign(path);
    const file = `${absolute}/SKILL.md`;
    if (!lstatSync(file).isFile()) foreign(file);
    const body = readFileSync(file, 'utf8');
    if (!body.includes(`name: ${path.split('/').at(-1)}\n`) || !/^\s*author: synapsync\s*$/m.test(body) || !parseSkillRuntimeVersion(body)) foreign(file);
  }
  plan.push({ action: 'remove', path });
}

/** Plan all ownership checks before applying anything; never remove through a skill link. */
export function buildMachineRemovalPlan(agents: Agent[], canonical: boolean): OperationPlan[] {
  assertRealRemovalParents(KYRO_MANIFEST_PATH);
  const manifestStat = statIfPresent(resolveManagedPath(KYRO_MANIFEST_PATH));
  if (manifestStat && !manifestStat.isFile()) foreign(KYRO_MANIFEST_PATH);
  const manifest = readManifest();
  const plan: OperationPlan[] = [];
  const removed = new Set<string>();
  const removedBlocks = new Set<string>();
  for (const agent of agents) {
    const adapter = getAdapterDefinition(agent);
    const files = adapter.buildManagedFiles().filter((path) => path.startsWith('~/') && !path.startsWith(`${AGENT_SKILLS_ROOT}/`));
    const directories = files.filter((path) => files.includes(`${path}/SKILL.md`));
    for (const path of directories) {
      addSkillRemoval(plan, path, manifest, false);
      removed.add(path); removed.add(`${path}/SKILL.md`);
    }
    const expected: OperationPlan[] = [];
    adapter.buildProjection(expected, { integrations: true, includeWorkspace: true });
    for (const path of files.filter((path) => !removed.has(path))) {
      assertRealRemovalParents(path);
      const stat = statIfPresent(resolveManagedPath(path));
      if (!stat) continue;
      if (!stat.isFile() || !owns(manifest, path) || readFileSync(resolveManagedPath(path), 'utf8') !== expected.find((operation) => operation.path === path)?.content) foreign(path);
      plan.push({ action: 'remove', path }); removed.add(path);
    }
    const integrations: OperationPlan[] = [];
    adapter.buildRemoval(integrations);
    adapter.buildMcpRemoval(integrations);
    for (const operation of integrations) {
      assertRealRemovalParents(operation.path);
      const stat = statIfPresent(resolveManagedPath(operation.path));
      if (!stat) continue;
      if (!stat.isFile()) foreign(operation.path);
      const body = readFileSync(resolveManagedPath(operation.path), 'utf8');
      const key = `${operation.path}#${operation.blockName ?? operation.jsonPath}`;
      if (operation.action === 'remove-block') {
        const start = startMarker(operation.blockName!, operation.commentStyle);
        const end = endMarker(operation.blockName!, operation.commentStyle);
        if (!body.includes(start) && !body.includes(end)) continue;
        if (!body.includes(start) || !body.includes(end)) foreign(operation.path);
        // Workspace blocks are independently owned by their explicit Kyro markers.
        if (operation.path.startsWith('~/') && !manifest?.managedBlocks.includes(key)) foreign(operation.path);
      } else if (operation.action === 'remove-json-key') {
        const document = JSON.parse(mergeJsonObjectContent(body, '{}')) as Record<string, unknown>;
        const get = (value: unknown): unknown => operation.jsonPath!.split('.').reduce<unknown>((current, segment) => typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[segment] : undefined, value);
        const actual = get(document);
        if (actual === undefined) continue;
        const overlay = expected.find((item) => item.action === 'merge-json' && item.path === operation.path);
        if (!manifest?.managedBlocks.includes(key) || !overlay || JSON.stringify(actual) !== JSON.stringify(get(JSON.parse(overlay.content!)))) foreign(operation.path);
      }
      if (!removedBlocks.has(key)) plan.push(operation);
      removedBlocks.add(key);
    }
  }
  if (canonical) for (const file of buildCommandSkillManagedFiles()) {
    const path = dirname(file);
    addSkillRemoval(plan, path, manifest, true);
    removed.add(path); removed.add(file);
  }
  if (manifest) {
    const next: KyroManifest = { ...manifest, adapters: manifest.adapters.filter((adapter) => !agents.includes(adapter.agent)), managedFiles: manifest.managedFiles.filter((path) => !removed.has(path)), managedBlocks: manifest.managedBlocks.filter((block) => !removedBlocks.has(block)) };
    plan.push({ action: 'write', path: KYRO_MANIFEST_PATH, content: `${JSON.stringify(next, null, 2)}\n` });
  }
  return plan;
}
