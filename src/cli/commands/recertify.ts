import { KyroCoreError } from '../core/errors';
import { resolveScope } from '../core/scope-resolution';
import { emitToolCommandRun } from '../core/trace';
import { readPackageVersion } from '../help';
import { planCertification, type CertificationPlan } from '../remediation/certification-plan';
import { applyCertificationTransaction } from '../remediation/certification-transaction';

/**
 * `kyro recertify` — record that a remediated scope's corrected state was independently validated.
 *
 * Deliberately separate from `kyro remediate`: remediate asserts "this correction was applied",
 * recertify asserts "the corrected state was checked against named evidence and passed". A
 * certificate covers one chain head, so remediating again drops it rather than carrying it forward.
 */
export function runRecertifyCommand(rawArgs: string[]): void {
  const [subcommand = '', ...rest] = rawArgs;
  if (subcommand === '' || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    printRecertifyHelp();
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
  throw new KyroCoreError('UNKNOWN_SUBCOMMAND', `Unknown recertify subcommand: ${subcommand}.`, 'Run kyro recertify --help.');
}

interface RecertifyArgs {
  manifest: string;
  scope: string | null;
  confirm: boolean;
  json: boolean;
  help: boolean;
}

function runPreview(rawArgs: string[]): void {
  const args = parseArgs(rawArgs, 'preview');
  if (args.help) {
    printRecertifyHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const plan = planCertification(buildOptions(scope, args.manifest));
  if (args.json) {
    console.log(JSON.stringify({ phase: 'preview', ...serializePlan(plan) }, null, 2));
    return;
  }
  printPlan(plan);
  console.log('\nPreview only. No files changed.');
  console.log(`Apply with: kyro recertify apply --kyro-scope ${scope} --manifest ${args.manifest} --yes`);
}

function runApply(rawArgs: string[]): void {
  const args = parseArgs(rawArgs, 'apply');
  if (args.help) {
    printRecertifyHelp();
    return;
  }
  const scope = resolveScope(args.scope);
  const options = buildOptions(scope, args.manifest);

  if (!args.confirm) {
    // Show exactly what apply would do, then stop. Confirmation is never implied by a valid plan.
    const plan = planCertification(options);
    printPlan(plan);
    throw new KyroCoreError(
      'CONFIRMATION_REQUIRED',
      'kyro recertify apply publishes an immutable certification record and anchors it into the live scope.',
      'Re-run with --yes (or --confirm) once the plan above is what you intend to certify.',
    );
  }

  emitToolCommandRun(scope, 'cli', 'recertify', { op: 'apply', manifest: args.manifest });
  const result = applyCertificationTransaction(options);
  if (args.json) {
    console.log(JSON.stringify({ phase: 'applied', resumed: result.resumed, ...serializePlan(result.plan) }, null, 2));
    return;
  }
  printPlan(result.plan);
  console.log('');
  console.log(result.resumed
    ? `Resumed interrupted certification ${result.certificationId} and completed it.`
    : `Certification ${result.certificationId} applied.`);
  console.log(`- record  ${result.recordPath}`);
  console.log(`- anchor  ${result.sprintPath} certifications[] += ${result.certificationId}`);
  console.log(`- commitment ${result.commitment}`);
  console.log('Checkpoints, snapshots, narratives, ledger commitments and remediation records were not modified.');
}

function buildOptions(scope: string, manifest: string): { scope: string; manifestPath: string; now: string; kyroVersion: string } {
  return { scope, manifestPath: manifest, now: new Date().toISOString(), kyroVersion: readPackageVersion() };
}

function serializePlan(plan: CertificationPlan): Record<string, unknown> {
  return {
    scope: plan.scope,
    certificationId: plan.certificationId,
    recordPath: plan.recordPath,
    sprintPath: plan.sprintPath,
    commitment: plan.commitment,
    certifiedChainHeadCommitment: plan.record.certifiedChainHeadCommitment,
    certifiedStateDigest: plan.record.certifiedStateDigest,
    evidence: plan.record.evidence,
    verdict: plan.record.verdict,
    provenance: plan.record.provenance,
    transactionStatus: plan.transactionStatus,
    transactionDetail: plan.transactionDetail,
  };
}

function printPlan(plan: CertificationPlan): void {
  console.log(`Certification ${plan.certificationId} for scope ${plan.scope}`);
  console.log(`- chain head    ${plan.record.certifiedChainHeadCommitment}`);
  console.log(`- certified state ${plan.record.certifiedStateDigest}`);
  for (const entry of plan.evidenceSummary) {
    console.log(`- ${entry} (re-verified)`);
  }
  console.log(`- verdict       ${plan.record.verdict.checker}: ${plan.record.verdict.outcome}`);
  console.log(`- record        ${plan.recordPath}`);
  console.log(`- transaction   ${plan.transactionStatus}: ${plan.transactionDetail}`);
}

function parseArgs(rawArgs: string[], subcommand: string): RecertifyArgs {
  let manifest = '';
  let scope: string | null = null;
  let confirm = false;
  let json = false;
  let help = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--yes' || arg === '--confirm') confirm = true;
    else if (arg === '--json') json = true;
    else if (arg === '--kyro-scope') { scope = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--kyro-scope=')) scope = arg.slice('--kyro-scope='.length);
    else if (arg === '--manifest') { manifest = requireValue(rawArgs, i, arg); i += 1; }
    else if (arg.startsWith('--manifest=')) manifest = arg.slice('--manifest='.length);
    else throw new KyroCoreError('INVALID_INPUT', `Unknown recertify ${subcommand} option: ${arg}`);
  }
  if (!help && manifest.trim() === '') {
    throw new KyroCoreError(
      'INVALID_INPUT',
      `Usage: kyro recertify ${subcommand} --kyro-scope <scope> --manifest <path>`,
      '--manifest is required; a certification is always driven by explicit, re-verifiable evidence.',
    );
  }
  return { manifest, scope, confirm, json, help };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new KyroCoreError('INVALID_INPUT', `${flag} requires a value`);
  return value;
}

function printRecertifyHelp(): void {
  console.log(`Usage:
  kyro recertify preview --manifest <path> [--kyro-scope <scope>] [--json]
  kyro recertify apply --manifest <path> [--kyro-scope <scope>] --yes [--json]

Certify that a remediated scope's corrected state was independently validated. Publishes one
immutable C-NNN record and one live certifications[] anchor. History is never rewritten.

The manifest is a scope-certification-manifest v1 document:
  { schemaVersion, kind, scope, certifiedChainHeadCommitment,
    evidence: [{ source: { kind: 'kyro-task-verdict', scope, taskId, verdictDigest }
                       | { kind: 'external-artifact', path, contentDigest },
                 chainHeadCommitment }],
    verdict: { checker, outcome: 'pass' },
    provenance: { actor, reason } }

Every evidence digest is re-derived from the workspace at certification time; a digest that does not
reproduce is refused. Certification is also refused when the remediation chain does not replay to
live state, when the chain head has moved, when evidence is empty, or when the verdict is not a
pass. preview writes nothing; apply requires --yes. An interrupted apply reports PREPARED and is
resumed by re-running it — never duplicated.`);
}
