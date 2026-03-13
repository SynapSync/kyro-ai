#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;

function check(label, passed, detail) {
  const status = passed ? 'PASS' : 'FAIL';
  console.error(`  ${status}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!passed) failures++;
}

// Load files
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const hooksJson = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));

// Parse WORKFLOW.yaml (simple key-value extraction, no yaml parser needed)
const workflowRaw = fs.readFileSync(path.join(root, 'WORKFLOW.yaml'), 'utf8');
const workflowVersion = (workflowRaw.match(/^version:\s*"(.+)"/m) || [])[1];
const workflowHooks = [];
for (const m of workflowRaw.matchAll(/^\s+-\s+(\w+)/gm)) {
  // Only capture hooks section entries
  if (workflowRaw.indexOf(m[0]) > workflowRaw.indexOf('hooks:')) {
    // Stop if we hit the next top-level key
    const lineStart = workflowRaw.lastIndexOf('\n', workflowRaw.indexOf(m[0]));
    const beforeLine = workflowRaw.substring(0, lineStart);
    const lastSection = beforeLine.match(/^(\w+):/gm);
    if (lastSection && lastSection[lastSection.length - 1] === 'hooks:') {
      workflowHooks.push(m[1]);
    }
  }
}

// Standard Claude Code hook events
const standardEvents = new Set([
  'SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PreCompact', 'Stop', 'SessionEnd', 'UserPromptSubmit',
  'SubagentStart', 'SubagentStop'
]);

const hookEvents = Object.keys(hooksJson.hooks);
const hookEntries = hookEvents.reduce((sum, e) => sum + hooksJson.hooks[e].length, 0);

console.error('\n  Kyro sync check\n');

// 1. Version checks
check('package.json version', !!pkg.version, pkg.version);
check('WORKFLOW.yaml version matches package.json', workflowVersion === pkg.version,
  `WORKFLOW=${workflowVersion} vs package=${pkg.version}`);

// 2. Hook event count
check(`hooks.json has ${hookEvents.length} events, ${hookEntries} entries`, true);
check('WORKFLOW.yaml hook count matches hooks.json',
  workflowHooks.length === hookEvents.length,
  `WORKFLOW=${workflowHooks.length} vs hooks.json=${hookEvents.length}`);

// 3. Standard events allowlist
const nonStandard = hookEvents.filter(e => !standardEvents.has(e));
check('hooks.json contains only standard Claude Code events',
  nonStandard.length === 0,
  nonStandard.length > 0 ? `non-standard: ${nonStandard.join(', ')}` : undefined);

// 4. WORKFLOW.yaml hooks match hooks.json keys
const workflowSet = new Set(workflowHooks);
const hooksSet = new Set(hookEvents);
const missingInWorkflow = hookEvents.filter(e => !workflowSet.has(e));
const extraInWorkflow = workflowHooks.filter(e => !hooksSet.has(e));
check('WORKFLOW.yaml hooks match hooks.json keys',
  missingInWorkflow.length === 0 && extraInWorkflow.length === 0,
  missingInWorkflow.length > 0 ? `missing in WORKFLOW: ${missingInWorkflow.join(', ')}` :
  extraInWorkflow.length > 0 ? `extra in WORKFLOW: ${extraInWorkflow.join(', ')}` : undefined);

// 5. marketplace.json description counts
const mpDesc = marketplace.plugins[0].description;
const mpHooks = (mpDesc.match(/(\d+)\s+hooks/) || [])[1];
const mpAgents = (mpDesc.match(/(\d+)\s+agents/) || [])[1];
const mpCommands = (mpDesc.match(/(\d+)\s+commands/) || [])[1];
const mpSkills = (mpDesc.match(/(\d+)\s+skills/) || [])[1];

check('marketplace.json hook count matches reality',
  mpHooks === String(hookEvents.length),
  `marketplace=${mpHooks} vs actual=${hookEvents.length}`);
check('marketplace.json agent count is 4', mpAgents === '4', `marketplace=${mpAgents}`);
check('marketplace.json command count is 9', mpCommands === '9', `marketplace=${mpCommands}`);
check('marketplace.json skill count is 7', mpSkills === '7', `marketplace=${mpSkills}`);

// Summary
console.error(`\n  ${failures === 0 ? 'All checks passed' : failures + ' check(s) failed'}\n`);
process.exit(failures > 0 ? 1 : 0);
