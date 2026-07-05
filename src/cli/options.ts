import { AGENT, SCOPE } from './constants';
import { getAdapterDefinition, getInstallableAdapters } from './adapters/registry';
import { KyroCoreError } from './core/errors';
import type { Agent, CliOptions, InstallScope, PackVerbosity } from './types';

export function parseOptions(args: string[]): CliOptions {
  const agents: Agent[] = [];
  let scope: InstallScope = SCOPE.WORKSPACE;
  let dryRun = false;
  let yes = false;
  let help = false;
  let tokens = false;
  let artifacts = false;
  let adapters = false;
  let trace = false;
  let kyroScope: string | null = null;
  let task: string | null = null;
  let json = false;
  let verbosity: PackVerbosity = 'detailed';
  let purgeAdapterAssets = false;
  let prune = false;
  const evalCases: string[] = [];
  const evalTags: string[] = [];
  let evalList = false;
  let keepSandbox = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--yes' || arg === '-y' || arg === '--confirm') {
      yes = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--tokens') {
      tokens = true;
    } else if (arg === '--artifacts') {
      artifacts = true;
    } else if (arg === '--adapters') {
      adapters = true;
    } else if (arg === '--trace') {
      trace = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--verbosity') {
      const value = args[i + 1];
      if (!value) throw new KyroCoreError('INVALID_INPUT', '--verbosity requires a value', 'Use --verbosity concise|detailed.');
      verbosity = parseVerbosity(value);
      i += 1;
    } else if (arg.startsWith('--verbosity=')) {
      verbosity = parseVerbosity(arg.slice('--verbosity='.length));
    } else if (arg === '--purge-adapter-assets') {
      purgeAdapterAssets = true;
    } else if (arg === '--prune') {
      prune = true;
    } else if (arg === '--list') {
      evalList = true;
    } else if (arg === '--keep-sandbox') {
      keepSandbox = true;
    } else if (arg === '--case') {
      const value = args[i + 1];
      if (!value) throw invalidInput('--case requires a value', 'Use --case <id> or --case=<id>.');
      evalCases.push(value);
      i += 1;
    } else if (arg.startsWith('--case=')) {
      evalCases.push(arg.slice('--case='.length));
    } else if (arg === '--tag') {
      const value = args[i + 1];
      if (!value) throw invalidInput('--tag requires a value', 'Use --tag <tag> or --tag=<tag>.');
      evalTags.push(value);
      i += 1;
    } else if (arg.startsWith('--tag=')) {
      evalTags.push(arg.slice('--tag='.length));
    } else if (arg === '--kyro-scope') {
      const value = args[i + 1];
      if (!value) throw invalidInput('--kyro-scope requires a value', 'Use --kyro-scope <scope> or --kyro-scope=<scope>.');
      kyroScope = value;
      i += 1;
    } else if (arg.startsWith('--kyro-scope=')) {
      kyroScope = arg.slice('--kyro-scope='.length);
    } else if (arg === '--task') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        task = '';
      } else {
        task = value;
        i += 1;
      }
    } else if (arg.startsWith('--task=')) {
      task = arg.slice('--task='.length);
    } else if (arg === '--agent' || arg === '--agents') {
      const value = args[i + 1];
      if (!value) throw invalidInput(`${arg} requires a value`, `Use ${arg} <agent>[,<agent>] or ${arg}=<agent>[,<agent>].`);
      agents.push(...parseAgents(value));
      i += 1;
    } else if (arg.startsWith('--agent=')) {
      agents.push(...parseAgents(arg.slice('--agent='.length)));
    } else if (arg.startsWith('--agents=')) {
      agents.push(...parseAgents(arg.slice('--agents='.length)));
    } else if (arg === '--scope') {
      const value = args[i + 1];
      if (!value) throw invalidInput('--scope requires a value', 'Use --scope workspace or --scope global.');
      scope = parseScope(value);
      i += 1;
    } else if (arg.startsWith('--scope=')) {
      scope = parseScope(arg.slice('--scope='.length));
    } else {
      throw invalidInput(`Unknown option: ${arg}`, 'Run kyro <command> --help.');
    }
  }

  return {
    agents: uniqueAgents(agents),
    scope,
    dryRun,
    yes,
    help,
    tokens,
    artifacts,
    adapters,
    trace,
    kyroScope,
    task,
    json,
    verbosity,
    purgeAdapterAssets,
    prune,
    evalCases,
    evalTags,
    evalList,
    keepSandbox,
  };
}

export function parseAgent(value: string): Agent {
  const normalized = value.toLowerCase();
  if (normalized === 'standard' || normalized === 'agents' || normalized === '.agents' || normalized === 'default') return AGENT.STANDARD;
  if (normalized === 'opencode') return AGENT.OPENCODE;
  if (normalized === 'claude' || normalized === 'claude-code') return AGENT.CLAUDE;
  if (normalized === 'codex') return AGENT.CODEX;
  if (normalized === 'cursor') return AGENT.CURSOR;
  throw invalidInput(
    `Unsupported agent: ${value}.`,
    `Use one of: ${getInstallableAdapters().map((adapter) => adapter.agent).join(', ')}. Use root AGENTS.md for cross-agent instructions; no generic adapter is installed.`,
  );
}

export function parseVerbosity(value: string): PackVerbosity {
  if (value === 'concise' || value === 'detailed') return value;
  throw new KyroCoreError('INVALID_INPUT', `Unsupported verbosity: ${value}.`, 'Use concise or detailed.');
}

export function parseScope(value: string): InstallScope {
  if (value === SCOPE.WORKSPACE) return SCOPE.WORKSPACE;
  if (value === SCOPE.GLOBAL) return SCOPE.GLOBAL;
  throw invalidInput(`Unsupported scope: ${value}.`, 'Use workspace or global.');
}

export function uniqueAgents(agents: Agent[]): Agent[] {
  return [...new Set(agents)];
}

export function assertWorkspaceScope(scope: InstallScope): void {
  if (scope !== SCOPE.WORKSPACE) {
    throw invalidInput('Only --scope workspace is implemented in Plan B Sprint 1.', 'Global install is planned but not active yet.');
  }
}

export function assertInstallableAgents(agents: Agent[]): void {
  const unsupported = agents.filter((agent) => getAdapterDefinition(agent).status !== 'implemented');
  if (unsupported.length > 0) {
    throw invalidInput(
      `Agent adapter not implemented yet: ${unsupported.join(', ')}.`,
      `Implemented now: ${getInstallableAdapters().map((adapter) => adapter.agent).join(', ')}. Claude plugin remains first-class through .claude-plugin/.`,
    );
  }
}

function parseAgents(value: string): Agent[] {
  return value.split(',').map((item) => parseAgent(item.trim())).filter(Boolean);
}

function invalidInput(message: string, remedy: string): KyroCoreError {
  return new KyroCoreError('INVALID_INPUT', message, remedy);
}
