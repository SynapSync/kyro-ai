---
title: 'canonical-debt-contract-and-legacy-remediation — Sprint 5: Original incident and release certification'
date: '2026-08-10'
scope: 'canonical-debt-contract-and-legacy-remediation'
sprint: 5
slug: 'original-incident-release-gate'
outcome: 'shipped'
type: 'sprint-archive'
---

# Sprint 5: Original incident and release certification

> Closed: 2026-08-10
> Outcome: shipped

## Objective

Close the remaining release boundary: stabilize Lens test isolation, prove the exact legacy debt incident through an isolated candidate package and a temporary copy, and document the supported upgrade and remediation path without modifying the original scope or making an unverified publication claim.

## Definition of Done

- debt-2 is resolved only after three clean complete Lens test runs under a reported supported Node 22 runtime and a regression binds the isolation fix.
- The faithful original incident passes source dist, packed tarball, temporary installed candidate, Doctor, recertification, and Lens gates only in temporary copies; original-source and immutable-history inventories remain unchanged.
- R8 and R9 scenarios have executable coverage, and the package contains every runtime asset, fixture, checker, and document required by the release gate.
- Docs accurately state the 4.43.5 origin-only limitation, upgrade path, explicit operator authority, append-only boundaries, and source/package/global/publication evidence distinctions.
- The aggregate local release matrix is green with no unaccounted critical or high findings; no publish, global runtime replacement, commit, or sprint close occurs in this sprint without separate user approval.

## Phases

### P1 — Stable independent verifier baseline

> Resolve the deferred Lens test-isolation defect under a supported, explicit Node runtime before using Lens as release evidence.

#### T5.1: Eliminate Lens assistant draft-store test leakage

**Status**: done

**Description**: Reproduce and fix debt-2 in the Lens checkout under an explicitly pinned supported Node 22 runtime. Identify the cross-file state boundary for assistant-chat composer drafts, make reset/ownership deterministic without weakening per-chat draft behavior, and add a regression that fails when another test file changes worker ordering. Do not mask the failure by serializing all tests, retrying failed tests, or clearing unrelated global state.

**Evidence**:
- Summary: debt-2 reproduced under Node v22.22.1 and root-caused: it is neither a cross-file leak nor a draft-store defect. assistant-chat.test.tsx advanced past an in-flight send as soon as the streamed reply text rendered, while sending was still true; AssistantSessionList renders session buttons disabled={busy} (busy = sending || sessionBusy), so HTMLElement.click() on a disabled button was a silent no-op and the chat never switched. The assertion then read the sending chat's empty draft. No composerDrafts writer in assistant.tsx ever removes another session's draft.
- Validation: Reproduction, Node v22.22.1: full suite 877 passed / 1 failed, assistant-chat 'clears only the active chat draft after a successful send', expected '' to be 'parked-draft'.
- Validation: Isolation disproves cross-file: same file alone (102 tests) failed 1 of 3 runs; single test alone passed 5 of 5. Failure is intra-file and timing-dependent, contradicting debt-2's cross-file/worker-order framing.
- Validation: Mechanism confirmed by source: assistant-session-list.tsx:310 disabled={busy}; assistant.tsx:1501 busy={sending || sessionBusy}; assistant.tsx:1379 handleSelectSession early-returns when sending.
- Validation: Fix: added clickWhenEnabled() test helper that waits for the control to be enabled before clicking and fails loudly if it never enables. No retries, no test-order pinning, no suite serialization, no global-state clearing, no production change.
- Validation: Regression added: 'blocks chat switching until a turn settles, without touching parked drafts' gates the fake provider's stream to hold a turn open, asserts every session button is disabled in that window, asserts a click in that window is a no-op, then asserts the other chat's parked draft survives after settle.
- Validation: Regression is load-bearing: mutating assistant-session-list.tsx disabled={busy} to disabled={false} makes it fail at assistant-chat.test.tsx:4677 ('session switching must be blocked in flight', expected true received false). Source restored, git diff --stat empty.
- Validation: Node v22.22.1: five consecutive full runs, each 64 test files / 879 tests passed, 0 failed (three required).
- Validation: CORRECTION to this task's original evidence. The typecheck first recorded here ('tsc --noEmit -p tsconfig.json exit 0') was VACUOUS: Lens's root tsconfig.json is a solution file with files:[] and project references, so -p on it checks nothing and exits 0 in about 0.04s. Discovered during T5.5 because the matrix step was implausibly fast. Re-verified with the real command, node node_modules/typescript/bin/tsc -b --force on Node v22.22.1: exit 0 in 3.0s. The typecheck claim holds; the original method did not establish it.
- Validation: Node v22.22.1: vite build ok; node scripts/check-guard-mutations.mjs exit 0, 16 assertions over 4 guards.
- Validation: Runtime distinction: all evidence above is Node v22.22.1 (engines >=20). Node v25.2.1 remains separately known-bad because its native localStorage shadows jsdom's; no Node 25 result is used here.
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/components/kyro/views/assistant-chat.test.tsx`
- Notes: debt-2's recorded diagnosis was wrong on both counts (cross-file, draft-store leak). The real defect was in the test's synchronization with the send lifecycle. No assistant.tsx or assistant-session-list.tsx change was needed or made; per-chat draft behavior is unchanged. Evidence re-recorded to correct a vacuous typecheck claim.

**Verdict**: pass — [object Object]; [object Object] (waived: The assistant-chat draft store has an explicit test-safe ownership/reset boundary, and the active-chat clearing behavior remains correct while other chats retain their drafts. — Premise disproved. The draft store is component-local React state in assistant.tsx and no writer removes another session's draft, so there is no ownership/reset boundary to add; introducing test-only reset would add cleanup production does not have. The second half is verified: the sending chat's draft clears and the other chat's parked draft survives, asserted by both the original test and the new regression.)

---
### P2 — Faithful incident execution matrix

> Turn the exact observed legacy shape into a reproducible, fail-closed source/package/runtime/Lens acceptance gate without touching Aliva.

#### T5.2: Build the isolated source and package incident harness

**Status**: done

**Description**: Add one deterministic Kyro release harness that starts from the faithful D1 raw shape and its historical checkpoint variants, inventories immutable bytes and SHA-256 values, then runs source dist and a tarball installed into a fresh temporary prefix. The harness must prove the pre-remediation refusal, read-only prepare/preview, explicit operator-authorized v3 canonicalization, atomic apply/resume semantics, Doctor, and recertification. It must label the checked-out global 4.43.5 runtime as a compatibility observation, never as evidence that the candidate package was exercised.

**Evidence**:
- Summary: Added scripts/check-original-incident-release.mjs, wired as npm run check:original-incident-release. It proves the faithful D1 incident end to end against two runtimes independently: the built source dist, and the candidate tarball produced by npm pack and installed into a fresh temporary prefix. 354 assertions pass. It also forced a real release-integrity fix: the candidate reported the same version 4.43.5 as the shipped origin-only runtime while having debt.canonicalize, so the candidate was bumped to 4.44.0.
- Validation: node scripts/check-original-incident-release.mjs exit 0, 354 assertions. Report: candidate kyro-ai@4.44.0 packed+installed to a temp prefix, full flow green; source dist 4.44.0 full flow green asserted independently; canonical result origin=1 priority=high targetSprint=null, retired addedSprint/detail/resolution; global runtime 4.43.5 ORIGIN-ONLY, observation only.
- Validation: Faithful shape asserted from fixtures/debt-contract/golden.json: live D1 keeps a string origin, keeps detail/resolution/addedSprint, and has neither priority nor targetSprint; historical-d1-sprint-1 and -2 keep string origins.
- Validation: Sentinel proven to bite: 9 in-memory cleanups of the corpus (origin canonicalized to 1, origin deleted, each of detail/resolution/addedSprint removed, priority filled in, targetSprint filled in, the live D1 case deleted, a historical variant canonicalized) are each required to make the shape assertion throw.
- Validation: Write-target safety proven, not merely claimed: assertTemporary refuses the Kyro checkout, a directory inside it, the home directory, and any unresolved relative path; every fixture root, rehearsal and probe dir is asserted to resolve under the OS temp root, and HOME is redirected into the fixture so nothing reaches the real ~/.agents.
- Validation: Immutability: SHA-256 inventory of every archive checkpoint/.checkpoint.json, snapshot/.json and narrative/.md plus a digest of every existing ledger entry, compared after the read-only phase, after canonicalization, and at end of flow. Remediation and certification artifacts are excluded as the only things permitted to grow.
- Validation: Flow covered per runtime: pre-remediation doctor refusal naming origin; canonicalize-prepare INPUT_REQUIRED naming origin/priority/targetSprint with no manifest and no write; prepare READY at schemaVersion 3 with one debt.canonicalize op and still no write; canonicalize-preview accepted read-only; replanted record visible as R-001 PREPARED; remediate apply resuming byte-for-byte with no duplicate R-002; exactly seven canonical keys in order with operator-authorized values; legacy keys retired; D2 untouched; recorded after-image equal to live and retiredKeys exact; doctor exit 0 reporting 'replayed through R-001'; status remediated; recertify apply bound to the chain head read from the immutable C-001 record; status recertified; doctor clean.
- Validation: Source and package do not share a label: runIncidentFlow executes the whole sequence separately per runtime and re-derives after-image, retiredKeys, chain head, record schemaVersion and reported version from that runtime's own output; equality between them is asserted only afterwards.
- Validation: Package completeness asserted from the installed tree: dist/cli.js, fixtures/debt-contract/golden.json, scripts/check-original-incident-release.mjs, config.json and WORKFLOW.yaml all present, and the packaged golden corpus is digest-equal to the source corpus and passes the same faithful-shape sentinel.
- Validation: Global runtime handled as observation only: probed for --version and remediate --help in a temp cwd, never written, never used as candidate evidence; presence re-asserted unchanged after the probe.
- Validation: npm run build exit 0; node scripts/check-versions.mjs reports All versions match: 4.44.0.
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/scripts/check-original-incident-release.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/package.json`
- Notes: Version bump 4.43.5 -> 4.44.0 across package.json, .claude-plugin/plugin.json, WORKFLOW.yaml and package-lock.json per CLAUDE.md. Reason: the gate must tell the candidate apart from the shipped origin-only runtime, and T5.4 must document 'X adds debt.canonicalize' without contradicting '4.43.5 is origin-only'. The gate now fails if an origin-only runtime ever shares the candidate's version string. This is a working-tree change only: nothing committed, nothing published, ~/.agents/kyro/current untouched. T5.3's --original-scope probe is implemented in the same file but reports not-requested until T5.3 runs it.

**Verdict**: pass — [object Object]

---
#### T5.3: Probe the actual incident only through a temporary copy and Lens

**Status**: done

**Description**: Locate the actual local model-catalog-and-routing scope by read-only inspection, verify its observed D1 shape and immutable inventory, and copy only the verified project/scope input into a newly created temporary directory. Run the candidate package flow there, then load that temporary resulting scope through Lens's real parser, provenance resolver, and focused UI contract tests. The original checkout must remain byte-for-byte unchanged and un-staged.

**Evidence**:
- Summary: The real incident is now proven against BOTH runtimes: source dist and the candidate tarball installed into a fresh temporary prefix, each in its own independent temporary copy of the original scope, each verified separately by Lens. probeOriginalScope() takes the runtime as a parameter instead of hardcoding dist/cli.js. Gate at 469 assertions (was 407). The original Aliva checkout remains byte-identical, git-clean and un-rescoped.
- Validation: REVIEW FIX. probeOriginalScope(projectRoot, runtime) is now parameterized; the previous version hardcoded distRoot/cli.js, so the gate proved only that the source checkout could repair model-catalog-and-routing, never that kyro-ai@4.44.0 as packaged could. That was the exact limit R8 exists to remove.
- Validation: Both runtimes run the real scope end to end, each in its OWN fresh temp copy: canonicalize-prepare READY, remediate apply, exactly seven canonical keys, archive checkpoint/snapshot/narrative SHA-256 and ledger commitments unchanged, doctor --artifacts exit 0, recertify apply, status 'Verification: recertified'. Gate output: 'original copy / source dist: repaired at protocol v3, doctor clean, recertified' and 'original copy / installed candidate package: repaired at protocol v3, doctor clean, recertified'.
- Validation: Lens verifies EACH runtime's result separately, including the packaged one: 'Lens verified 2 tests on v22.22.1 (read-only)' reported for both copies. The gate asserts !requireLens || viaPackage.lens.run, so the packaged result cannot pass unverified, and it still requires exactly 2 PASSED so a skipped suite fails rather than reporting a vacuous green.
- Validation: Cross-runtime agreement is asserted between two independently produced artifacts: identical canonical after-image, identical retiredKeys, and the two remediation RECORDS identical once createdAt is set aside. Both records are re-read from disk per runtime rather than compared to a shared expectation.
- Validation: An over-strong assertion was found and corrected rather than worked around. Requiring chainHead equality across runtimes failed (source d30ae85c... vs package 95fe82b8...). A remediation record carries createdAt, so two runs minutes apart must hash differently by design; comparing the records modulo the timestamp is both correct and stronger. The gate now also asserts the converse - that differing timestamps cannot share a commitment - so the head is proven to bind createdAt.
- Validation: The installed candidate is kept alive for this probe: installCandidatePackage() returns the runtime and registers temp-prefix cleanup on process exit, so the packaged CLI is available to the real-scope probe instead of being torn down after the fixture flow.
- Validation: Original untouched, verified after BOTH probes: git status --porcelain empty, HEAD 34fdc055a56c07458d50f129be0e27c6aebded5f, D1 still carries origin 'food-analysis FR-FA-013 revision' and all three legacy keys, remediations still 0. The gate independently compares the scope's SHA-256 inventory, git state and local.json before and after each run.
- Validation: Full gate: node scripts/check-original-incident-release.mjs --original-scope <aliva> --require-original-scope --lens <kyro-lens> --lens-node <node22> --require-lens => 469 assertions passed.
- Validation: Lens on Node v22.22.1: tsc -b --force exit 0; full suite 64 files, 879 passed, 2 skipped, 0 failed.
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/scripts/check-original-incident-release.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/test/original-incident.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/data/remediation-real-contract.test.ts`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-lens/src/components/kyro/views/overview.test.tsx`
- Notes: Earlier defects in this task's tests, all mine and all caught by the tools rather than assumed away: Lens key-order (its parser rebuilds each debt, so order belongs to the raw bytes, where Kyro had written the exact canonical order); DIVERGED on unreadable certification evidence (addressed workspace-relative, my loader exposed only the scope dir); three TS2339 errors hidden by a vacuous typecheck. No Aliva data is checked into kyro-lens; both copies are transient and removed in finally blocks.

**Verdict**: pass — [object Object]

---
### P3 — Operator boundary and release proof

> Make the upgrade path and evidence boundary explicit, then aggregate the independent checks without publishing or mutating user installations.

#### T5.4: Document the supported remediation and upgrade boundary

**Status**: done

**Description**: Document the historical 4.43.5 limitation, the candidate/release version containing protocol-v3 debt.canonicalize, the explicit operator workflow, required values, prepare/preview/apply/Doctor/recertify sequence, Lens verification, and the difference between source, packed candidate, temporary installed candidate, current global runtime, and publication evidence. Add a documentation checker so a future edit cannot claim that origin-only 4.43.5 repairs the full incident or that Lens performs repairs.

**Evidence**:
- Summary: Documented the 4.43.5 origin-only limitation, the 4.44.0 upgrade that adds debt.canonicalize, the explicit operator workflow, and the six-way evidence boundary, across README.md, docs/cli.md, docs/release-checklist.md and CHANGELOG.md. Added scripts/check-remediation-release-docs.mjs (86 assertions) and wired it into npm run check.
- Validation: node scripts/check-remediation-release-docs.mjs exit 0, 86 documentation assertions passed (4.43.5 origin-only, 4.44.0 adds debt.canonicalize). Versions are read from package.json, never hardcoded, so a bump cannot leave the docs describing a version that no longer exists.
- Validation: docs/cli.md gained a full 'Legacy debt remediation and recertification' section: a capability table contrasting 4.43.5 debt.origin.set with 4.44.0 debt.canonicalize, the explicit statement that 4.43.5 cannot repair a record-level legacy shape, the seven canonical keys, the legacy keys retired, operator authority (suggestion is never an authorization; priority and targetSprint carry no suggestion at all), a copyable seven-step workflow, expected failure boundaries (stale manifest, INPUT_REQUIRED, PREPARED resume without duplication, older readers unsupported, certificate must bind the current head, no automatic migration), and Lens as read-only verifier. The file previously had no remediation documentation at all.
- Validation: The checker enforces workflow ORDER, not just presence: doctor, canonicalize-prepare, canonicalize-preview, remediate apply --yes, Verification: remediated, recertify apply --yes, Verification: recertified must appear in that sequence. A doc listing the steps out of order fails.
- Validation: docs/release-checklist.md gained an evidence-boundary table distinguishing source checkout, packed tarball, temporary installed candidate, current global runtime, Kyro Lens and publication, each with what it does NOT prove; plus the rules that a green local matrix does not authorize a publish, that ~/.agents/kyro/current must never be replaced to test a candidate, and that a candidate shipping new operations must ship a new version.
- Validation: Seven forbidden claim patterns are refused across all four docs: 4.43.5 repairing the full/record-level shape, debt.origin.set retiring legacy keys, Lens repairing or writing, automatic migration of scopes, already-published claims, rewriting checkpoints/snapshots/narratives/ledger, and Kyro inferring priority or targetSprint for the operator. They are matched as patterns because the dangerous version of a claim is the paraphrase.
- Validation: The checker self-tests: each forbidden pattern is fed a tripwire sentence it must match, so a pattern that would silently catch nothing fails the checker itself.
- Validation: Proven to bite by three deliberate edits: adding 'Kyro Lens repairs the scope when it detects drift.' to README failed with the read-only-verifier message; replacing the origin-only sentence failed with two missing-claim messages; setting package.json version back to 4.43.5 failed with 'Bump the version', naming the contradiction. All three reverted, git diff clean on those hunks.
- Validation: Wired into npm run check between check:canonicalization-gate and check:eval. npm run check:links passes (75 files, all relative links valid); npm run check:no-placeholder passes.
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/README.md`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/docs/cli.md`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/docs/release-checklist.md`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/CHANGELOG.md`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/scripts/check-remediation-release-docs.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/package.json`
- Notes: The candidate version is now defined by package metadata as 4.44.0 (bumped during T5.2), which is what let the docs name the version that adds debt.canonicalize without contradicting the 4.43.5 origin-only statement. CHANGELOG entry is under [4.44.0] and makes no publication claim.

**Verdict**: pass

---
#### T5.5: Run the aggregate release certification matrix

**Status**: done

**Description**: Wire and execute a release matrix that requires Kyro build/check, the faithful source/package/temporary-copy gate, actual npm tarball inventory, Lens typecheck/build/full tests under the reported supported Node runtime, real-contract provenance tests, and documentation checks. Report precise evidence boundaries and preserve separate failures for candidate package, global runtime, original-source access, Lens, and publication. This task prepares a release decision only; it must not publish, alter ~/.agents/kyro/current, commit unrelated work, or close the sprint.

**Evidence**:
- Summary: Aggregate matrix re-run after the review fixes: 12/12 steps green for kyro-ai@4.44.0 with Lens on Node v22.22.1, now including the packaged candidate exercised against the REAL model-catalog-and-routing scope and Lens-verified on that result. analyze is clean (0 findings) after linking T5.1 to S15 via the CLI.
- Validation: node scripts/check-release-matrix.mjs --lens <kyro-lens> --lens-node <node22> --original-scope <aliva> => 12/12 green. candidate 5 passed (build 1.8s; npm run check 161.5s; npm pack --dry-run; doctor --tokens; doctor --artifacts); original-scope 1 passed (8.0s, now covering both runtimes); docs 1 passed; lens 5 passed (typecheck tsc -b --force 3.2s, build 2.9s, full suite 6.9s, real-contract tests, guard mutations 6.2s).
- Validation: R8 gap closed: the original-incident gate now runs the real scope through source dist AND the installed candidate tarball, in separate temporary copies, each Lens-verified. 469 assertions (was 407).
- Validation: analyze: [OK] no semantic issues found. The prior A001 (T5.1 without a scenario reference) was resolved by kyro scenario link --task T5.1 --scenario S15 through the CLI, not by hand-editing sprint.json. The mapping is substantive: S15 names Lens running the flow against temporary copies as part of its 'when', and T5.1 is what makes that Lens evidence trustworthy under Node 22.
- Validation: doctor --artifacts exit 0, all checks PASS, including the four ledger-checkpoint identity/commitment checks and four checkpoint historical-integrity checks.
- Validation: Boundaries remain structural: candidate, original-scope, lens, docs each report pass/fail separately; global-runtime is reported as '4.43.5 — ORIGIN-ONLY, cannot repair a record-level legacy shape (observation; not written, not the candidate)' and never counted as pass or fail.
- Validation: Original checkout re-verified after both probes: git status --porcelain empty, HEAD 34fdc055a56c07458d50f129be0e27c6aebded5f, D1 still string-origin with all three legacy keys, remediations 0. Global runtime still 4.43.5, unwritten.
- Validation: The Lens typecheck no-op found in the previous round remains fixed: tsc -b --force, with any Lens typecheck completing in under one second downgraded to a failure.
- Files changed: `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/scripts/check-release-matrix.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/scripts/check-original-incident-release.mjs`, `/Users/rperaza/joicodev/my-projects/kyro-ecosistem/kyro-ai/package.json`
- Notes: No publish, no commit, no tag, no global-runtime replacement, no sprint close. Candidate version 4.44.0 remains an uncommitted working-tree change.

**Verdict**: pass — [object Object]

---

## Learnings

- A local fixture-only or source-only pass is insufficient for release; the actual scope must be exercised by the isolated packaged runtime and independently verified by Lens.
- A test flake must be reproduced in isolation before assigning blame to shared state; the assistant-chat issue was an in-flight disabled-control synchronization race.

## Resolved Debt

- **debt-1**: Lens assistant-model-select suite fails on localStorage.clear in the current vitest/jsdom environment
- **debt-2**: Lens assistant chat-draft store leaks across test files, so an added test file changes assistant-chat.test.tsx's result

## Recommendations for Sprint 6

- Before npm publication, commit the certified 4.44.0 changes, run hosted CI, and publish only after its separate release gate passes.
- After publication, update the installed Kyro runtime deliberately; do not treat the current 4.43.5 global runtime as the 4.44.0 candidate.
