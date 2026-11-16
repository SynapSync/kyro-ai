import { AGENT, SCOPE } from './constants';
import { getAdapterDefinition, getInstallableAdapters } from './adapters/registry';
import { KyroCoreError } from './core/errors';
import { flag, option, parseFlags, takeIfPlain, takeNonEmpty, takeNonEmptyUnlessDashed, type FlagSpec } from './core/flags';
import type { Agent, CliOptions, InstallScope, PackVerbosity } from './types';

type ParsedOptions = CliOptions & { machine: boolean };

const needsValue = (flagName: string, remedy: string) => takeNonEmpty(() => invalidInput(`${flagName} requires a value`, remedy));

const verbosityValue = takeNonEmpty(() => new KyroCoreError('INVALID_INPUT', '--verbosity requires a value', 'Use --verbosity concise|detailed.'));
const agentValue = takeNonEmpty((token) => invalidInput(`${token} requires a value`, `Use ${token} <agent>[,<agent>] or ${token}=<agent>[,<agent>].`));

const OPTION_FLAGS: readonly FlagSpec<ParsedOptions>[] = [
  flag(['--dry-run'], (o) => { o.dryRun = true; }),
  flag(['--yes', '-y', '--confirm'], (o) => { o.yes = true; }),
  flag(['--help', '-h'], (o) => { o.help = true; }),
  flag(['--tokens'], (o) => { o.tokens = true; }),
  flag(['--artifacts'], (o) => { o.artifacts = true; }),
  flag(['--adapters'], (o) => { o.adapters = true; }),
  flag(['--integrations'], (o) => { o.integrations = true; }),
  flag(['--machine'], (o) => { o.machine = true; }),
  flag(['--trace'], (o) => { o.trace = true; }),
  flag(['--json'], (o) => { o.json = true; }),
  flag(['--verbose'], (o) => { o.verbose = true; }),
  option(['--verbosity'], verbosityValue, (o, value) => { o.verbosity = parseVerbosity(value); }, true),
  flag(['--purge-adapter-assets'], (o) => { o.purgeAdapterAssets = true; }),
  flag(['--prune'], (o) => { o.prune = true; }),
  flag(['--init-workspace'], (o) => { o.initWorkspace = true; }),
  flag(['--no-init-workspace'], (o) => { o.noInitWorkspace = true; }),
  flag(['--list'], (o) => { o.evalList = true; }),
  flag(['--keep-sandbox'], (o) => { o.keepSandbox = true; }),
  flag(['--check'], (o) => { o.check = true; }),
  flag(['--matrix'], (o) => { o.matrix = true; }),
  option(['--case'], needsValue('--case', 'Use --case <id> or --case=<id>.'), (o, value) => { o.evalCases.push(value); }, true),
  option(['--tag'], needsValue('--tag', 'Use --tag <tag> or --tag=<tag>.'), (o, value) => { o.evalTags.push(value); }, true),
  option(['--kyro-scope'], needsValue('--kyro-scope', 'Use --kyro-scope <scope> or --kyro-scope=<scope>.'), (o, value) => { o.kyroScope = value; }, true),
  // `--task` with no usable value records an empty task instead of failing.
  option(['--task'], takeIfPlain, (o, value) => { o.task = value; }, true),
  option(
    ['--sprint-file'],
    takeNonEmptyUnlessDashed(() => invalidInput('--sprint-file requires a path', 'Use --sprint-file <path> (repeatable).')),
    (o, value) => { o.sprintFiles.push(value); },
    true,
  ),
  option(['--agent', '--agents'], agentValue, (o, value) => { o.agents.push(...parseAgents(value)); }, true),
  option(['--scope'], needsValue('--scope', 'Use --scope workspace or --scope global.'), (o, value) => { o.scope = parseScope(value); }, true),
];

export function parseOptions(args: string[]): ParsedOptions {
  const options: ParsedOptions = {
    agents: [],
    scope: SCOPE.WORKSPACE,
    dryRun: false,
    yes: false,
    help: false,
    tokens: false,
    artifacts: false,
    adapters: false,
    integrations: false,
    machine: false,
    trace: false,
    kyroScope: null,
    task: null,
    sprintFiles: [],
    json: false,
    verbosity: 'detailed',
    verbose: false,
    purgeAdapterAssets: false,
    prune: false,
    initWorkspace: false,
    noInitWorkspace: false,
    evalCases: [],
    evalTags: [],
    evalList: false,
    keepSandbox: false,
    check: false,
    matrix: false,
  };
  parseFlags(OPTION_FLAGS, args, options, (arg) => {
    throw invalidInput(`Unknown option: ${arg}`, 'Run kyro <command> --help.');
  });
  if (options.initWorkspace && options.noInitWorkspace) {
    throw invalidInput('Cannot combine --init-workspace and --no-init-workspace.', 'Choose one workspace initialization mode.');
  }
  options.agents = uniqueAgents(options.agents);
  return options;
}

export function parseAgent(value: string): Agent {
  const normalized = value.toLowerCase();
  if (normalized === 'standard' || normalized === 'agents' || normalized === '.agents' || normalized === 'default') return AGENT.STANDARD;
  if (normalized === 'opencode') return AGENT.OPENCODE;
  if (normalized === 'claude' || normalized === 'claude-code') return AGENT.CLAUDE;
  if (normalized === 'codex') return AGENT.CODEX;
  if (normalized === 'pi') return AGENT.PI;
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
      `Implemented now: ${getInstallableAdapters().map((adapter) => adapter.agent).join(', ')}.`,
    );
  }
}

function parseAgents(value: string): Agent[] {
  return value.split(',').map((item) => parseAgent(item.trim())).filter(Boolean);
}

function invalidInput(message: string, remedy: string): KyroCoreError {
  return new KyroCoreError('INVALID_INPUT', message, remedy);
}
