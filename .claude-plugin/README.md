# Kyro Claude Code Adapter

This directory packages Kyro for Claude Code. Kyro itself is a portable, markdown-first workflow kit for AI coding agents; this adapter registers its commands, orchestrator, and skills in Claude Code.

## Installation

### Via Marketplace

```bash
/plugin marketplace add SynapSync/kyro-ai
/plugin install kyro-ai@kyro-ai
```

Or via CLI:

```bash
claude plugin marketplace add SynapSync/kyro-ai
claude plugin install kyro-ai@kyro-ai
```

### Local Install

```bash
claude --plugin-dir /path/to/kyro-ai
```

## Documentation

See the main [README](../README.md) and [agent adapters guide](../docs/agent-adapters.md) for the portable workflow contract and non-Claude setup paths.
