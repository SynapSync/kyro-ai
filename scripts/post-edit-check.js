#!/usr/bin/env node
const { debugLog } = require('./lib/paths');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path || '';
    const newString = input.tool_input?.new_string || '';

    const issues = [];

    // Check for debug statements
    if (/console\.(log|debug|info)\s*\(/.test(newString)) {
      issues.push('console.log/debug statement detected');
    }
    if (/\bdebugger\b/.test(newString)) {
      issues.push('debugger statement detected');
    }

    // Check for potential secrets
    if (/(['"])(?:sk-|pk_|api[_-]?key|secret|password|token)\1/i.test(newString)) {
      issues.push('Potential hardcoded secret/API key detected');
    }

    // Check for TODOs
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(newString)) {
      issues.push('TODO/FIXME comment added — track in debt table');
    }

    if (issues.length > 0) {
      console.error(`[Kyro] Issues in ${filePath}:`);
      issues.forEach(issue => console.error(`  ⚠ ${issue}`));
    }
  } catch (e) {
    debugLog('post-edit-check: ' + e.message);
  }

  console.log(data);
});
