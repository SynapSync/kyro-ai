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
 * @param {NodeJS.ProcessEnv} [env] Environment object to inspect.
 * @returns {Record<string, boolean>} Named detection signals.
 */
function collectSignals(env = process.env) {
  return {
    claude_plugin_root: Boolean(env.CLAUDE_PLUGIN_ROOT),
    claude_project_dir: Boolean(env.CLAUDE_PROJECT_DIR),
    cursor_agent: Boolean(env.CURSOR_AGENT),
    cursor_trace_id: Boolean(env.CURSOR_TRACE_ID),
    kilo_code: Boolean(env.KILO_CODE),
    codex_home: Boolean(env.CODEX_HOME)
  };
}

/**
 * Resolves the best harness profile key from collected signals.
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

/**
 * Detects the active harness from environment signals.
 *
 * @param {NodeJS.ProcessEnv} [env] Environment object to inspect.
 * @returns {{ harnessId: string, signals: Record<string, boolean>, harness: object }} Detection result.
 */
function detectHarness(env = process.env) {
  const signals = collectSignals(env);
  const harnessId = resolveHarnessId(signals);

  return {
    harnessId,
    signals,
    harness: HARNESS_PROFILES[harnessId]
  };
}

/**
 * Merges a detected harness block into an existing config object.
 *
 * @param {object} existingConfig Current project config.
 * @param {object} harness Detected harness block.
 * @returns {object} Config with only the harness section replaced.
 */
function mergeHarnessConfig(existingConfig, harness) {
  return {
    ...existingConfig,
    harness: { ...harness }
  };
}

/**
 * Builds a before/after preview for harness apply operations.
 *
 * @param {object} existingConfig Current project config.
 * @param {object} harness Detected harness block.
 * @returns {{ before: object, after: object, changed: boolean }} Apply preview.
 */
function buildApplyPreview(existingConfig, harness) {
  const before = existingConfig.harness || {};
  const after = { ...harness };

  return {
    before,
    after,
    changed: JSON.stringify(before) !== JSON.stringify(after)
  };
}

module.exports = {
  HARNESS_PROFILES,
  buildApplyPreview,
  collectSignals,
  detectHarness,
  mergeHarnessConfig,
  resolveHarnessId
};
