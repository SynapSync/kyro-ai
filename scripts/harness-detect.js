#!/usr/bin/env node

const { pass } = require('./lib/workflow-utils');

const HARNESS_PROFILES = {
  'claude-code': {
    id: 'claude-code',
    capabilities: {
      slash_commands: true,
      subagents: true,
      post_edit_hooks: true,
      project_memory: false
    },
    enforcement: 'hooks'
  },
  cursor: {
    id: 'cursor',
    capabilities: {
      slash_commands: false,
      subagents: true,
      post_edit_hooks: false,
      project_memory: false
    },
    enforcement: 'manual'
  },
  'kilo-code': {
    id: 'kilo-code',
    capabilities: {
      slash_commands: false,
      subagents: true,
      post_edit_hooks: false,
      project_memory: false
    },
    enforcement: 'manual'
  },
  codex: {
    id: 'codex',
    capabilities: {
      slash_commands: false,
      subagents: false,
      post_edit_hooks: false,
      project_memory: false
    },
    enforcement: 'manual'
  },
  generic: {
    id: 'generic',
    capabilities: {
      slash_commands: false,
      subagents: false,
      post_edit_hooks: false,
      project_memory: false
    },
    enforcement: 'manual'
  }
};

/**
 * Collects environment signals that suggest the active coding harness.
 *
 * @returns {Record<string, boolean>} Named detection signals.
 */
function collectSignals() {
  return {
    claude_plugin_root: Boolean(process.env.CLAUDE_PLUGIN_ROOT),
    claude_project_dir: Boolean(process.env.CLAUDE_PROJECT_DIR),
    cursor_agent: Boolean(process.env.CURSOR_AGENT),
    cursor_trace_id: Boolean(process.env.CURSOR_TRACE_ID),
    kilo_code: Boolean(process.env.KILO_CODE),
    codex_home: Boolean(process.env.CODEX_HOME)
  };
}

/**
 * Resolves the best harness profile from collected signals.
 *
 * @param {Record<string, boolean>} signals Named detection signals.
 * @returns {keyof typeof HARNESS_PROFILES} Harness profile key.
 */
function resolveHarnessId(signals) {
  if (signals.claude_plugin_root || signals.claude_project_dir) {
    return 'claude-code';
  }

  if (signals.cursor_agent || signals.cursor_trace_id) {
    return 'cursor';
  }

  if (signals.kilo_code) {
    return 'kilo-code';
  }

  if (signals.codex_home) {
    return 'codex';
  }

  return 'generic';
}

const signals = collectSignals();
const harnessId = resolveHarnessId(signals);
const profile = HARNESS_PROFILES[harnessId];

pass('Harness detection completed.', [
  {
    detected_harness: harnessId,
    signals,
    suggested_config: {
      harness: profile
    }
  }
]);
