---
title: '{{scope}} — Sprint {{n}}: {{title}}'
date: '{{closedAt}}'
scope: '{{scope}}'
sprint: {{n}}
slug: '{{slug}}'
outcome: '{{outcome}}'
type: 'sprint-archive'
---

# Sprint {{n}}: {{title}}

> Closed: {{closedAt}}
> Outcome: {{outcome}}

## Objective

{{objective}}

## Definition of Done

{{#each definitionOfDone}}
- {{this}}
{{/each}}

## Phases

{{#each phases}}
### {{id}} — {{title}}

> {{objective}}

{{#each tasks}}
#### {{id}}: {{title}}

**Status**: {{status}}

**Description**: {{description}}

**Files touched**: {{#each files_to_touch}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}

**Evidence**:
{{#if evidence}}
- Summary: {{evidence.summary}}
- Validation: {{evidence.validation}}
- Files changed: {{#each evidence.files_changed}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}
{{#if evidence.notes}}- Notes: {{evidence.notes}}{{/if}}
{{else}}
_No evidence recorded._
{{/if}}

**Verdict**: {{#if verdict}}{{verdict.result}}{{#if verdict.findings}} — {{#each verdict.findings}}{{this}}{{#unless @last}}; {{/unless}}{{/each}}{{/if}}{{else}}_Not reviewed._{{/if}}

---
{{/each}}
{{/each}}

## Learnings

{{#each learnings}}
- {{this}}
{{/each}}

## Resolved Debt

{{#each resolvedDebt}}
- **{{id}}**: {{title}} _(resolved in Sprint {{../n}})_
{{/each}}

## Recommendations for Sprint {{nextN}}

{{#each recommendationsForNext}}
- {{this}}
{{/each}}
