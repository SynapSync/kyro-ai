import { KyroCoreError } from '../core/errors';
import { flag, helpFlag, option, parseFlags, takeUnlessDashed, type FlagSpec } from '../core/flags';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import { readPackageVersion } from '../help';
import { planRemediation, type RemediationPlan } from '../remediation/plan';
import { applyRemediationTransaction } from '../remediation/transaction';
import { prepareDebtCanonicalization, previewDebtCanonicalization } from '../remediation/canonicalize-surface';

/**
 * `kyro remediate` — correct the live state of a closed scope without touching its history.
 *
 * Deliberately separate from `kyro repair`: repair normalizes deterministic formatting drift in a
 * scope that is already valid, while remediate applies typed, audited corrections to a scope whose
 * persisted state no longer satisfies the contract, and leaves an immutable record behind.
 */
export function runRemediateCommand(rawArgs: string[]): void {
  const [subcommand = '', ...rest] = rawArgs;
  if (subcommand === '' || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    printRemediateHelp();
    return;
  }
  if (subcommand === 'preview') {
    runPreview(rest);
    return;
  }
  if (subcommand === 'apply') {
    runApply(rest);
    return;
  }
  if (subcommand === 'canonicalize-prepare') {
    runCanonicalizePrepare(rest);
    return;
  }
  if (subcommand === 'canonicalize-preview') {
    runCanonicalizePreview(rest);
    return;
  }
  throw new KyroCoreError('UNKNOWN_SUBCOMMAND', `Unknown remediate subcommand: ${subcommand}.`, 'Run kyro remediate --help.');
}

interface RemediateArgs {
  manifest: string;
  scope: string | null;
  confirm: boolean;
  json: boolean;
  help: boolean;
}

function runPreview(rawArgs: string[]): void {
  const args = parseArgs(rawArgs, 'preview');
  if (args.help) {
    printRemediateHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const plan = planRemediation(buildOptions(scope, args.manifest));
  if (args.json) {
    console.log(JSON.stringify({ phase: 'preview', ...serializePlan(plan) }, null, 2));
    return;
  }
  printPlan(plan);
  console.log('\nPreview only. No files changed.');
  console.log(`Apply with: kyro remediate apply --kyro-scope ${scope} --manifest ${args.manifest} --yes`);
}

function runApply(rawArgs: string[]): void {
  const args = parseArgs(rawArgs, 'apply');
  if (args.help) {
    printRemediateHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const options = buildOptions(scope, args.manifest);

  if (!args.confirm) {
    // Show exactly what apply would do, then stop. Confirmation is never implied by a valid plan.
    const plan = planRemediation(options);
    printPlan(plan);
    throw new KyroCoreError(
      'CONFIRMATION_REQUIRED',
      'kyro remediate apply rewrites a closed scope\'s live state and writes an immutable remediation record.',
      'Re-run with --yes (or --confirm) once the plan above is what you intend to apply.',
    );
  }

  emitToolCommandRun(scope, 'cli', 'remediate', { op: 'apply', manifest: args.manifest });
  const result = applyRemediationTransaction(options);
  if (args.json) {
    console.log(JSON.stringify({ phase: 'applied', resumed: result.resumed, ...serializePlan(result.plan) }, null, 2));
    return;
  }
  printPlan(result.plan);
  console.log('');
  console.log(result.resumed
    ? `Resumed interrupted remediation ${result.remediationId} and completed it.`
    : `Remediation ${result.remediationId} applied.`);
  console.log(`- record  ${result.recordPath}`);
  console.log(`- anchor  ${result.sprintPath} remediations[] += ${result.remediationId}`);
  console.log(`- commitment ${result.commitment}`);
  console.log('Historical checkpoints, snapshots, narratives and ledger commitments were not modified.');
}

/**
 * `canonicalize-prepare` — read the live debt, apply only the decisions the operator stated, and
 * print either what is still undecided or a complete manifest. It writes nothing, not even the
 * manifest: that stays the operator's to review and save.
 */
function runCanonicalizePrepare(rawArgs: string[]): void {
  const args = parseCanonicalizeArgs(rawArgs);
  if (args.help) {
    printRemediateHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const result = prepareDebtCanonicalization({
    scope,
    debtId: args.debtId,
    decisions: args.decisions,
    reason: args.reason ?? undefined,
    actor: args.actor ?? undefined,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Canonicalization preparation for ${scope} debt ${result.debtId} (read-only)`);
  console.log(`- classification   ${result.classification ?? '(unreadable)'}`);
  console.log(`- status           ${result.status}`);
  if (result.debtCollectionSha256 !== null) console.log(`- debt collection  ${result.debtCollectionSha256}`);
  for (const field of result.resolved) {
    console.log(`- ${field.source === 'observed' ? 'observed ' : 'decided  '} ${field.field} = ${JSON.stringify(field.value)}`);
  }
  if (result.retiredKeys.length > 0) console.log(`- retires          ${result.retiredKeys.join(', ')}`);
  for (const decision of result.unresolved) {
    const evidence = decision.evidence === null
      ? 'no evidence implies it — this is a judgment'
      : `evidence: ${decision.evidence} (suggests ${JSON.stringify(decision.suggested)}, which is not an authorization)`;
    console.log(`- NEEDS DECISION   ${decision.path} [${decision.reason}] ${decision.detail} ${evidence}`);
  }
  if (result.detail !== null) console.log(`- detail           ${result.detail}`);

  if (result.manifest === null) {
    console.log('\nNo manifest was produced. Nothing was written.');
    return;
  }
  console.log('\nComplete manifest (save it yourself — preparation writes nothing):');
  console.log(JSON.stringify(result.manifest, null, 2));
}

/** `canonicalize-preview` — re-check a manifest the operator holds against the state on disk. */
function runCanonicalizePreview(rawArgs: string[]): void {
  const args = parseArgs(rawArgs, 'canonicalize-preview');
  if (args.help) {
    printRemediateHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const result = previewDebtCanonicalization({ scope, manifestPath: args.manifest });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.accepted) process.exitCode = 1;
    return;
  }

  console.log(`Canonicalization preview for ${scope} (read-only)`);
  console.log(`- debt collection  ${result.debtCollectionSha256}`);
  for (const issue of result.issues) {
    console.log(`- REJECTED         ${issue.field} ${issue.message}`);
  }
  for (const after of result.after) {
    console.log(`- after-image      ${JSON.stringify(after)}`);
  }
  if (result.retiredKeys.length > 0) console.log(`- retires          ${result.retiredKeys.join(', ')}`);
  console.log(`\n${result.detail}`);
  if (!result.accepted) process.exitCode = 1;
}

interface CanonicalizeArgs {
  debtId: string;
  scope: string | null;
  decisions: Record<string, unknown>;
  reason: string | null;
  actor: string | null;
  json: boolean;
  help: boolean;
}

const remediateValue = takeUnlessDashed((flagName) => new KyroCoreError('INVALID_INPUT', `${flagName} requires a value`));

interface CanonicalizeState extends CanonicalizeArgs { decisions: Record<string, unknown> }

const canonicalizeOption = (name: string, apply: (state: CanonicalizeState, value: string) => void): FlagSpec<CanonicalizeState> => option([name], remediateValue, apply, true);

// Decisions are opt-in per field: an absent flag means "undecided", never "use the suggestion".
const CANONICALIZE_FLAGS: readonly FlagSpec<CanonicalizeState>[] = [
  helpFlag(),
  flag(['--json'], (s: CanonicalizeState) => { s.json = true; }),
  canonicalizeOption('--kyro-scope', (s, v) => { s.scope = v; }),
  canonicalizeOption('--debt', (s, v) => { s.debtId = v; }),
  canonicalizeOption('--reason', (s, v) => { s.reason = v; }),
  canonicalizeOption('--actor', (s, v) => { s.actor = v; }),
  canonicalizeOption('--origin', (s, v) => { s.decisions.origin = parseIntegerDecision(v, '--origin'); }),
  canonicalizeOption('--priority', (s, v) => { s.decisions.priority = v; }),
  canonicalizeOption('--target-sprint', (s, v) => { s.decisions.targetSprint = parseTargetSprint(v); }),
  canonicalizeOption('--note', (s, v) => { s.decisions.note = v; }),
];

function parseCanonicalizeArgs(rawArgs: string[]): CanonicalizeArgs {
  const state: CanonicalizeState = { debtId: '', scope: null, decisions: {}, reason: null, actor: null, json: false, help: false };
  parseFlags(CANONICALIZE_FLAGS, rawArgs, state, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown remediate canonicalize-prepare option: ${arg}`);
  });
  if (!state.help && state.debtId.trim() === '') {
    throw new KyroCoreError(
      'INVALID_INPUT',
      'Usage: kyro remediate canonicalize-prepare --kyro-scope <scope> --debt <id> [--origin n] [--priority p] [--target-sprint n|null] [--note text]',
      '--debt is required: canonicalization is record-level and always names the debt it describes.',
    );
  }
  return state;
}

/** A malformed decision is surfaced as such rather than quietly dropped into "undecided". */
function parseIntegerDecision(raw: string, flag: string): unknown {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : raw;
}

function parseTargetSprint(raw: string): unknown {
  if (raw === 'null' || raw === 'none') return null;
  return parseIntegerDecision(raw, '--target-sprint');
}

function buildOptions(scope: string, manifest: string): { scope: string; manifestPath: string; now: string; kyroVersion: string } {
  return { scope, manifestPath: manifest, now: new Date().toISOString(), kyroVersion: readPackageVersion() };
}

function serializePlan(plan: RemediationPlan): Record<string, unknown> {
  return {
    scope: plan.scope,
    remediationId: plan.remediationId,
    recordPath: plan.recordPath,
    sprintPath: plan.sprintPath,
    commitment: plan.commitment,
    base: plan.record.base,
    issues: plan.record.issues,
    operations: plan.record.operations,
    result: plan.record.result,
    provenance: plan.record.provenance,
    changes: plan.changes,
    transactionStatus: plan.transactionStatus,
    transactionDetail: plan.transactionDetail,
  };
}

function printPlan(plan: RemediationPlan): void {
  console.log(`Remediation ${plan.remediationId} for scope ${plan.scope}`);
  console.log(`- base state    ${plan.record.base.stateSha256}`);
  console.log(`- chain head    ${plan.record.base.remediationHead ?? '(none — first remediation)'}`);
  for (const checkpoint of plan.record.base.checkpoints) {
    console.log(`- checkpoint    ${checkpoint.path} @ ${checkpoint.commitment} (verified, unchanged)`);
  }
  for (const issue of plan.record.issues) {
    console.log(`- issue ${issue.id}    ${issue.code} at ${issue.path}`);
  }
  for (const change of plan.changes) {
    console.log(`- operation ${change.operationId} ${change.kind}: ${change.target} ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
  }
  console.log(`- result state  ${plan.record.result.stateSha256}`);
  console.log(`- record        ${plan.recordPath}`);
  console.log(`- transaction   ${plan.transactionStatus}: ${plan.transactionDetail}`);
}

const REMEDIATE_FLAGS: readonly FlagSpec<RemediateArgs>[] = [
  helpFlag(),
  // --confirm is the spelling used by the remediation design doc; --yes is the CLI-wide
  // convention. Both mean the same explicit approval.
  flag(['--yes', '--confirm'], (a: RemediateArgs) => { a.confirm = true; }),
  flag(['--json'], (a: RemediateArgs) => { a.json = true; }),
  option(['--kyro-scope'], remediateValue, (a, v) => { a.scope = v; }, true),
  option(['--manifest'], remediateValue, (a, v) => { a.manifest = v; }, true),
];

function parseArgs(rawArgs: string[], subcommand: string): RemediateArgs {
  const args: RemediateArgs = { manifest: '', scope: null, confirm: false, json: false, help: false };
  parseFlags(REMEDIATE_FLAGS, rawArgs, args, (arg) => {
    throw new KyroCoreError('INVALID_INPUT', `Unknown remediate ${subcommand} option: ${arg}`);
  });
  if (!args.help && args.manifest.trim() === '') {
    throw new KyroCoreError('INVALID_INPUT', `Usage: kyro remediate ${subcommand} --kyro-scope <scope> --manifest <path>`, '--manifest is required; a remediation is always driven by an explicit typed manifest.');
  }
  return args;
}

function printRemediateHelp(): void {
  console.log(`Usage:
  kyro remediate preview --manifest <path> [--kyro-scope <scope>] [--json]
  kyro remediate apply --manifest <path> [--kyro-scope <scope>] --yes [--json]
  kyro remediate canonicalize-prepare --debt <id> [--kyro-scope <scope>] [--origin <n>]
      [--priority <critical|high|medium|low>] [--target-sprint <n|null>] [--note <text>] [--json]
  kyro remediate canonicalize-preview --manifest <path> [--kyro-scope <scope>] [--json]

Apply a typed, append-only correction to a CLOSED scope's live state. Checkpoints, snapshots,
narratives and ledger commitments are immutable and are verified, never rewritten.

The manifest is a scope-remediation-manifest v1 document:
  { schemaVersion, kind, scope, base: { stateSha256, remediationHead },
    issues: [{ id, code, path, observedValueSha256 }],
    operations: [{ id, kind, resolves, ... }],
    provenance: { reason, actor } }

Only registry operations are accepted (v1/v2: debt.origin.set; v3 adds debt.canonicalize). Generic
JSON Patch is rejected by design. preview writes nothing; apply requires --yes and is atomic — any
failed digest, precondition, schema or post-write check aborts the whole batch without advancing the
scope. A batch is recorded at the lowest revision that admits every operation in it, so an
origin-only remediation is still written as v2 and only a canonicalization produces a v3 record.

canonicalize-prepare and canonicalize-preview are READ-ONLY. They describe the protocol v3
debt.canonicalize operation, which repairs a whole legacy debt record: a broken or absent canonical
field, and legacy-only keys such as detail/resolution/addedSprint that debt.origin.set cannot retire.

  prepare  reads the live debt and reports what is already observed, what is still undecided, and
           the evidence behind each suggestion. A suggested value is never an authorization: only
           the flags you pass become canonical values. With every value settled it prints a complete
           manifest to stdout for you to review and save — it never writes the manifest for you.
  preview  re-checks a manifest you hold against the state on disk, including the whole-debt digest,
           and shows the exact after-image only when the manifest is complete and still true.

There is no canonicalize-apply command: a reviewed v3 manifest is applied by remediate apply, the
same atomic append-only transaction the origin-only flow uses.`);
}
