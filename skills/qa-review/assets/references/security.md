# Security Review Reference

Use this reference when changes touch secrets, authentication, external commands, generated files, or repository automation.

## Checklist

- No hardcoded API keys, tokens, credentials, private keys, or passwords.
- Scripts avoid destructive shell operations unless explicitly requested.
- Inputs from files, CLI arguments, or environment variables are validated before use.
- Error output is actionable and does not leak secrets.
- Generated artifacts do not include local credentials or private absolute paths unless they are expected Kyro workspace paths.

## Automation-Specific Risks

- Hook scripts must be conservative to avoid false destructive behavior.
- Pre-commit checks should fail closed for confirmed blockers.
- Any optional bypass, such as `--skip-quality`, must be explicit and visible in the audit trail or sprint notes.
