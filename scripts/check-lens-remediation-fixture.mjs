#!/usr/bin/env node
/**
 * Explicit cross-repository conformance gate for Lens's checked-in remediation v1 fixture.
 *
 * This is deliberately not part of Lens CI: Lens tests only committed bytes. Maintainers can
 * opt in by setting KYRO_LENS_ROOT, which regenerates a real Kyro scope, verifies that Lens
 * consumes it, and compares the stable protocol profile with the checked-in fixture.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "../..");
const lensRoot = process.env.KYRO_LENS_ROOT;

if (!lensRoot) {
  console.error("KYRO_LENS_ROOT must point to a Kyro Lens checkout.");
  process.exit(2);
}

const lensFixture = join(lensRoot, "src/test/fixtures/remediation-v1");
if (!existsSync(join(lensFixture, "sprint.json"))) {
  console.error(`Lens remediation fixture is missing: ${lensFixture}`);
  process.exit(2);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function profile(root, generated) {
  const scopeRoot = generated ? join(root, ".agents/kyro/scopes/demo") : root;
  const sprint = readJson(join(scopeRoot, "sprint.json"));
  const remediation = readJson(join(scopeRoot, "archive/remediations/remediation-001.json"));
  const certification = readJson(join(scopeRoot, "archive/certifications/certification-001.json"));
  const remediationAnchor = sprint.remediations?.[0];
  const certificationAnchor = sprint.certifications?.[0];
  if (!remediationAnchor || !certificationAnchor) fail("fixture must contain one R-001 and one C-001 anchor");

  return {
    scope: sprint.scope,
    remediationAnchor: { id: remediationAnchor.id, path: remediationAnchor.path },
    certificationAnchor: { id: certificationAnchor.id, path: certificationAnchor.path },
    remediation: {
      schemaVersion: remediation.schemaVersion,
      kind: remediation.kind,
      id: remediation.id,
      scope: remediation.scope,
      issueCodes: remediation.issues?.map((issue) => issue.code),
      operationKinds: remediation.operations?.map((operation) => operation.kind),
    },
    certification: {
      schemaVersion: certification.schemaVersion,
      kind: certification.kind,
      certificationId: certification.certificationId,
      scope: certification.identity?.scope,
      evidenceKinds: certification.evidence?.map((entry) => entry.source?.kind),
      verdict: certification.verdict?.outcome,
    },
  };
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

const generatedRoot = mkdtempSync(join(tmpdir(), "kyro-lens-remediation-"));
try {
  const harness = join(repo, "scripts/check-verification-states.mjs");
  run(process.execPath, [harness], {
    cwd: repo,
    env: { ...process.env, KYRO_LENS_REAL_FIXTURE: generatedRoot },
  });

  const generatedProfile = profile(generatedRoot, true);
  const committedProfile = profile(lensFixture, false);
  if (JSON.stringify(generatedProfile) !== JSON.stringify(committedProfile)) {
    fail(`generated Kyro provenance profile differs from Lens fixture:\nexpected ${JSON.stringify(generatedProfile)}\nreceived ${JSON.stringify(committedProfile)}`);
  }

  run("pnpm", ["exec", "vitest", "run", "src/data/remediation-real-contract.test.ts"], {
    cwd: lensRoot,
    env: { ...process.env, KYRO_LENS_REAL_FIXTURE: generatedRoot },
  });
  console.log("check:lens-remediation-fixture — generated Kyro v1 provenance matches and Lens accepts it");
} finally {
  rmSync(generatedRoot, { recursive: true, force: true });
}
