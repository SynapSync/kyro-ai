#!/usr/bin/env node
// Portable no-follow brief ingestion (work create / amend-brief). Runs on POSIX and Windows CI: the
// platform path, a forced path without O_NOFOLLOW (Node exposes none on win32), swap races between the
// link check and the open, junctions, and a real `work create` through the compiled CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(fileURLToPath(import.meta.url), '../..');
const cli = join(repo, 'dist/cli.js');
const { readBriefSourceBytes } = await import(pathToFileURL(join(repo, 'dist/cli/work/brief-source.js')).href);
const root = mkdtempSync(join(tmpdir(), 'kyro-brief-source-'));
const failures = [];

function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const write = (name, text) => { const path = join(root, name); writeFileSync(path, text); return path; };
const rejects = (fn, pattern, label) => assert.throws(fn, (error) => error?.code === 'INVALID_INPUT' && pattern.test(error.message), label);
const BRIEF = '# Brief source\n\nShip a verifiable outcome.\n';
const MODES = [
  { label: 'platform flags', options: {} },
  { label: 'no O_NOFOLLOW (win32 behaviour)', options: { noFollowFlag: null } },
];

try {
  const regular = write('brief.md', BRIEF);
  const other = write('other.md', '# Other\n\nDifferent bytes.\n');
  const link = join(root, 'link.md');
  symlinkSync(regular, link, 'file');
  const dir = join(root, 'dir'); mkdirSync(dir);
  const junction = join(root, 'junction');
  symlinkSync(dir, junction, 'junction');

  for (const { label, options } of MODES) {
    check(`${label}: regular file reads exact bytes`, () => {
      const source = readBriefSourceBytes(regular, 'brief.md', options);
      assert.equal(source.text, BRIEF);
    });
    check(`${label}: symbolic link refused before open`, () => rejects(() => readBriefSourceBytes(link, 'link.md', options), /symbolic link/, 'symlink'));
    check(`${label}: junction / directory link refused`, () => rejects(() => readBriefSourceBytes(junction, 'junction', options), /symbolic link|not a regular file/, 'junction'));
    check(`${label}: directory refused`, () => rejects(() => readBriefSourceBytes(dir, 'dir', options), /not a regular file/, 'directory'));
    check(`${label}: swap to a symlink between check and open fails closed`, () => {
      const target = write(`race-link-${label.length}.md`, BRIEF);
      rejects(() => readBriefSourceBytes(target, 'race', { ...options, afterLinkCheck: () => { rmSync(target); symlinkSync(other, target, 'file'); } }),
        /replaced before it was opened|cannot be opened without following/, 'symlink swap');
    });
    check(`${label}: path replaced by a symlink to the same moved file fails closed`, () => {
      const target = write(`race-same-${label.length}.md`, BRIEF);
      const saved = join(root, `saved-${label.length}.md`);
      rejects(() => readBriefSourceBytes(target, 'race', { ...options, afterLinkCheck: () => { renameSync(target, saved); symlinkSync(saved, target, 'file'); } }),
        /cannot be opened without following symbolic links/, 'same-inode symlink swap');
    });
    check(`${label}: swap to another regular file between check and open fails closed`, () => {
      const target = write(`race-file-${label.length}.md`, BRIEF);
      const replacement = write(`replacement-${label.length}.md`, 'replacement\n');
      rejects(() => readBriefSourceBytes(target, 'race', { ...options, afterLinkCheck: () => renameSync(replacement, target) }), /replaced before it was opened/, 'file swap');
    });
  }

  const cliRun = (...args) => spawnSync(process.execPath, [cli, 'work', ...args], { cwd: root, encoding: 'utf8' });
  const snapshot = (id) => ({
    work: readFileSync(join(root, `.agents/kyro/work/${id}/work.json`)),
    brief: readFileSync(join(root, `.agents/kyro/work/${id}/brief.md`)),
  });

  check('work create + amend-brief (CLI, real platform): full flows publish, linked sources are refused without writes', () => {
    const created = cliRun('create', '--id', 'brief-flow', '--from', 'brief.md', '--json');
    assert.equal(created.status, 0, `${created.stdout}${created.stderr}`);
    const before = snapshot('brief-flow');
    assert.equal(before.brief.toString('utf8'), BRIEF, 'create publishes the exact brief bytes');

    const revision = JSON.parse(before.work).revision;
    const amendArgs = (from) => ['amend-brief', '--work', 'brief-flow', '--from', from, '--reason', 'Revise outcome.', '--by', 'maintainer', '--expect-revision', String(revision), '--json'];
    const linkedAmend = cliRun(...amendArgs('link.md'));
    assert.notEqual(linkedAmend.status, 0, 'linked amend source must be refused');
    assert.match(`${linkedAmend.stdout}${linkedAmend.stderr}`, /symbolic link/);
    const afterRefusal = snapshot('brief-flow');
    assert(afterRefusal.work.equals(before.work) && afterRefusal.brief.equals(before.brief), 'a refused amend leaves work.json and brief.md byte-identical');
    assert(!existsSync(join(root, '.agents/kyro/work/brief-flow/.pending-brief-amendment.json')), 'a refused amend leaves no pending record');

    const revised = write('revised.md', '# Brief source\n\nShip a revised verifiable outcome.\n');
    const amended = cliRun(...amendArgs('revised.md'));
    assert.equal(amended.status, 0, `${amended.stdout}${amended.stderr}`);
    assert.equal(snapshot('brief-flow').brief.toString('utf8'), readFileSync(revised, 'utf8'), 'amend publishes the exact revised bytes');
  });

  check('work create (CLI, real platform) accepts a regular brief and refuses a linked one', () => {
    const ok = spawnSync(process.execPath, [cli, 'work', 'create', '--id', 'brief-ok', '--from', 'brief.md', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
    const linked = spawnSync(process.execPath, [cli, 'work', 'create', '--id', 'brief-linked', '--from', 'link.md', '--json'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(linked.status, 0, 'linked brief must be refused');
    assert.match(`${linked.stdout}${linked.stderr}`, /symbolic link/);
    assert(!existsSync(join(root, '.agents/kyro/work/brief-linked')), 'refused source publishes no Work');
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length) { console.error(`\n${failures.length} brief-source check(s) failed`); process.exit(1); }
console.log(`\nbrief source OK (${process.platform})`);
