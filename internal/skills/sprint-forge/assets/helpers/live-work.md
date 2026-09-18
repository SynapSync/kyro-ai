# Live Work Remedy

Load this helper when a scoped `context-pack --json` or status/error envelope includes a blocker with `remedyCommand`. The command is a structured recovery handoff for current work; it is not a request to edit managed JSON.

## Authority decision

Apply the remedy without another user turn only when all of these are true:

1. It corrects already-authorized, still-open work in the selected scope and its current sprint.
2. Its operation is one of these local live-work cases:
   - `plan --update-active` for active requirements or tasks;
   - `rule update`, `rule remove`, or `rule replace` for a scope-local convention;
   - `plan --roadmap` for planned future roadmap entries.
3. Its meaning, target scope, input, preview diff, and digest are unambiguous. Use the checkout's resolved `{{KYRO_CLI}}`, never a PATH command, and preserve the command's required preview/digest/apply protocol.

For those cases, consume `remedyCommand`: prepare any required input, preview it, inspect the complete diff, then apply the same authorized change with its preview digest. Do not treat a mechanical confirmation flag as user identity or as authority beyond the already-authorized live change.

Ask the user before proceeding when the remedy discards a scope, changes project policy, has an ambiguous meaning or target, expands authority, or falls outside the three cases above. A scope discard always needs informed human consent, even when a later CLI apply uses its digest and confirmation flag.

## Doctor-after gate

Immediately after every successful live-work apply, run:

```bash
{{KYRO_CLI}} doctor --artifacts --kyro-scope <scope> --json
```

Doctor failure blocks further routing: report its output and do not hand-repair state. If the apply reports an error after writing, re-read the scoped pack and follow the CLI's retry/remedy guidance; never repeat blindly or restore state by hand.

Then re-run `{{KYRO_CLI}} context-pack --kyro-scope <scope> --json` and route only from the refreshed pack.
