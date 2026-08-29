import { writeSync } from 'node:fs';
import { TOOL_OWNED_VERBS } from './capabilities';
import { toErrorEnvelope } from './errors';

const CLI_PHASE = {
  RESULT: 'result',
  PREVIEW: 'preview',
  APPLIED: 'applied',
  NOOP: 'noop',
} as const;

export type CliPhase = (typeof CLI_PHASE)[keyof typeof CLI_PHASE];

export interface CliEnvelopeSuccessV1<T> {
  schemaVersion: 1;
  ok: true;
  command: string;
  phase: CliPhase;
  data: T;
}

export interface CliEnvelopeErrorV1 {
  schemaVersion: 1;
  ok: false;
  command: string;
  error: {
    code: string;
    message: string;
    remedy?: string;
    remedyCommand?: string;
    details?: Record<string, unknown>;
  };
}

export type CliEnvelopeV1<T> = CliEnvelopeSuccessV1<T> | CliEnvelopeErrorV1;

export interface CliMutationResultV1 {
  outcome: 'preview' | 'applied' | 'noop';
  scope: string | null;
  digest?: string;
  operationId?: string;
  resumed: boolean;
  affectedFiles: string[];
  requiresConfirmation: boolean;
  nextAction: string | null;
  output?: string[];
}

interface MachineInvocation {
  enabled: boolean;
  argv: string[];
  command: string;
}

interface CapturedOutput {
  stdout: string;
  stderr: string;
}

interface OutputCapture {
  stop(): CapturedOutput;
}

let explicitResult: { phase: CliPhase; data: unknown } | null = null;

const NATIVE_JSON_VERBS = new Set(['analyze', 'capabilities', 'context-pack', 'doctor', 'repair', 'status']);
const LEGACY_JSON_VERBS = new Set(['detect', 'eval', 'install', 'mcp', 'recertify', 'remediate', 'sync', 'trace', 'tui', 'uninstall']);
const READ_ONLY_VERBS = new Set(['analyze', 'context-pack', 'doctor', 'status']);

export function prepareMachineInvocation(rawArgv: string[]): MachineInvocation {
  const requested = rawArgv.includes('--json');
  const withoutJson = rawArgv.filter((arg) => arg !== '--json');
  const command = withoutJson[0] ?? '';
  const help = command === 'help' || withoutJson.includes('--help') || withoutJson.includes('-h');
  if (!requested) return { enabled: false, argv: rawArgv, command: commandName(withoutJson) };
  if (help) return { enabled: false, argv: withoutJson, command: commandName(withoutJson) };
  if (LEGACY_JSON_VERBS.has(command)) return { enabled: false, argv: rawArgv, command: commandName(withoutJson) };

  const argv = NATIVE_JSON_VERBS.has(command) ? [...withoutJson, '--json'] : withoutJson;
  return { enabled: true, argv, command: commandName(withoutJson) };
}

export function setCliMachineResult(phase: CliPhase, data: unknown): void {
  explicitResult = { phase, data };
}

export function startOutputCapture(): OutputCapture {
  let stdout = '';
  let stderr = '';
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stderr.write;
  return {
    stop(): CapturedOutput {
      process.stdout.write = stdoutWrite as typeof process.stdout.write;
      process.stderr.write = stderrWrite as typeof process.stderr.write;
      return { stdout, stderr };
    },
  };
}

export function emitMachineSuccess(command: string, argv: string[], captured: CapturedOutput): void {
  const provided = explicitResult;
  explicitResult = null;
  const parsed = parseSingleJson(captured.stdout);
  const phase = provided?.phase ?? derivePhase(argv, captured.stdout);
  const data = provided?.data ?? (parsed ?? deriveData(command, argv, phase, captured));
  const envelope: CliEnvelopeSuccessV1<unknown> = {
    schemaVersion: 1,
    ok: true,
    command,
    phase,
    data,
  };
  writeEnvelope(envelope);
}

export function emitMachineError(command: string, error: unknown): void {
  explicitResult = null;
  const source = toErrorEnvelope(error);
  const remedyCommand = extractRemedyCommand(source.remedy);
  const requiresConfirmation = source.code === 'CONFIRMATION_REQUIRED' || source.code === 'HUMAN_APPROVAL_REQUIRED';
  const envelope: CliEnvelopeErrorV1 = {
    schemaVersion: 1,
    ok: false,
    command,
    error: {
      ...source,
      ...(remedyCommand ? { remedyCommand } : {}),
      ...(requiresConfirmation ? { details: { requiresConfirmation: true, nextAction: remedyCommand ?? null } } : {}),
    },
  };
  writeEnvelope(envelope);
}

function writeEnvelope(envelope: CliEnvelopeV1<unknown>): void {
  writeSync(1, `${JSON.stringify(envelope)}\n`);
}

function commandName(argv: string[]): string {
  const [command = '', subcommand = ''] = argv;
  if (['scope', 'repair', 'debt', 'scenario', 'adr', 'rule'].includes(command) && subcommand && !subcommand.startsWith('-')) {
    return `${command} ${subcommand}`;
  }
  return command || '(none)';
}

function derivePhase(argv: string[], output: string): CliPhase {
  if (argv.includes('--dry-run') || /\bpreview\b|Dry run complete/i.test(output)) return CLI_PHASE.PREVIEW;
  if (/\bnoop\b|No files changed|already applied|resumed=true[^\n]*no files/i.test(output)) return CLI_PHASE.NOOP;
  return isMutating(argv) ? CLI_PHASE.APPLIED : CLI_PHASE.RESULT;
}

function isMutating(argv: string[]): boolean {
  const command = argv[0] ?? '';
  if (!TOOL_OWNED_VERBS.includes(command as (typeof TOOL_OWNED_VERBS)[number])) return false;
  if (READ_ONLY_VERBS.has(command)) return false;
  if (command === 'scope' && !['set-active', 'retire', 'complete', 'reopen'].includes(argv[1] ?? '')) return false;
  return true;
}

function deriveData(command: string, argv: string[], phase: CliPhase, captured: CapturedOutput): unknown {
  const lines = `${captured.stdout}${captured.stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!isMutating(argv)) return { output: lines };
  const digest = matchValue(lines, /\b(?:digest|requestDigest|operationId)\s*[=:]\s*([a-f0-9]{64})\b/i);
  const operationId = matchValue(lines, /\boperationId\s*[=:]\s*([^\s,]+)/i);
  const nextAction = matchValue(lines, /\bNext action:\s*([^\n.]+)/i);
  const files = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/(?:^|\s)((?:\.agents\/kyro\/|\/[^\s]*\.agents\/kyro\/)[^\s,]+)/g)) {
      files.add(match[1].replace(/[.:;]+$/, ''));
    }
  }
  const result: CliMutationResultV1 = {
    outcome: phase === CLI_PHASE.PREVIEW ? 'preview' : phase === CLI_PHASE.NOOP ? 'noop' : 'applied',
    scope: optionValue(argv, '--kyro-scope'),
    ...(digest ? { digest } : {}),
    ...(operationId ? { operationId } : {}),
    resumed: /\bresumed=true\b/i.test(lines.join('\n')),
    affectedFiles: [...files],
    requiresConfirmation: false,
    nextAction: nextAction ?? null,
    ...(lines.length > 0 ? { output: lines } : {}),
  };
  return result;
}

function optionValue(argv: string[], flag: string): string | null {
  const direct = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function matchValue(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function parseSingleJson(output: string): unknown | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed) as unknown; }
  catch { return null; }
}

function extractRemedyCommand(remedy: string | undefined): string | undefined {
  if (!remedy) return undefined;
  const command = remedy.match(/(?:^|\n|Run:?\s+)((?:npx|node|kyro)\s+[^\n`]+)/i)?.[1]?.trim();
  return command?.replace(/[.]+$/, '');
}
