# Using Kyro Skills with Claude API

This guide explains how to use kyro-workflow skills programmatically via the Anthropic Claude API.

## Overview

The Anthropic Claude API allows you to use kyro-workflow skills by including them as system prompts or in your message context. This is useful for:

- Automated code review workflows
- Programmatic sprint planning
- CI/CD pipeline integration
- Custom applications built on top of Claude

---

## Quick Start

### Installation

```bash
# Install Anthropic SDK
npm install @anthropic-ai/sdk
# or
pip install anthropic
```

### Basic Example: Code Review with qa-review

```javascript
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic();

// Load the qa-review skill
const qaReviewSkill = fs.readFileSync(
  "skills/qa-review/SKILL.md",
  "utf-8"
);

async function reviewCode(filePath, changeDescription) {
  const fileContent = fs.readFileSync(filePath, "utf-8");

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    system: qaReviewSkill,
    messages: [
      {
        role: "user",
        content: `Please review this code change.

File: ${filePath}
Description: ${changeDescription}

Code:
\`\`\`
${fileContent}
\`\`\`

Provide your review following the APPROVED/CHANGES REQUIRED/REJECTED format.`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : null;
}

// Usage
const review = await reviewCode(
  "src/auth.ts",
  "Add OAuth2 support"
);
console.log(review);
```

---

## Loading Skills Programmatically

### From File System

```javascript
import fs from "fs";

function loadSkill(skillName) {
  return fs.readFileSync(`skills/${skillName}/SKILL.md`, "utf-8");
}

const qaReview = loadSkill("qa-review");
const sprintForge = loadSkill("sprint-forge");
```

### From Network

```javascript
async function loadSkillFromGitHub(repo, skillName, branch = "main") {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/skills/${skillName}/SKILL.md`;
  const response = await fetch(url);
  return response.text();
}

const qaReview = await loadSkillFromGitHub(
  "SynapSync/kyro-workflow",
  "qa-review"
);
```

---

## Use Cases

### 1. Automated Code Review in CI/CD

```javascript
async function reviewPullRequest(prFiles) {
  const qaReviewSkill = loadSkill("qa-review");

  for (const file of prFiles) {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      system: qaReviewSkill,
      messages: [
        {
          role: "user",
          content: `Review this file:

File: ${file.path}
Changes:
${file.diff}

Verdict only: APPROVED | APPROVED WITH NOTES | CHANGES REQUIRED | REJECTED`,
        },
      ],
    });

    console.log(`${file.path}: ${response.content[0].text}`);
  }
}
```

### 2. Sprint Planning with sprint-forge

```javascript
async function generateSprint(projectContext, roadmap, previousFindings) {
  const sprintForgeSkill = loadSkill("sprint-forge");

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8000,
    system: sprintForgeSkill,
    messages: [
      {
        role: "user",
        content: `Generate SPRINT-2 for scope: oauth-implementation

Project Context:
${projectContext}

Roadmap:
${roadmap}

Previous Sprint Findings:
${previousFindings}

Generate the sprint using the SPRINT template format.`,
      },
    ],
  });

  return response.content[0].text;
}
```

### 3. Multi-Agent Code Review

```javascript
async function comprehensiveReview(codeChange) {
  const [qaSkill, archSkill] = await Promise.all([
    loadSkill("qa-review"),
    // You could create additional review-focused skills
  ]);

  // First: Security & Code Quality
  const qaReview = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    system: qaSkill,
    messages: [
      {
        role: "user",
        content: `Review for security, code quality, and architecture:

${codeChange}

Focus on: Critical and Major issues only.`,
      },
    ],
  });

  return {
    qaReview: qaReview.content[0].text,
  };
}
```

---

## Python Example

```python
import anthropic
import os

def load_skill(skill_name):
    with open(f"skills/{skill_name}/SKILL.md", "r") as f:
        return f.read()

def review_code(file_path, description):
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    
    qa_skill = load_skill("qa-review")
    
    with open(file_path, "r") as f:
        code_content = f.read()
    
    message = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        system=qa_skill,
        messages=[
            {
                "role": "user",
                "content": f"""Please review this code change.

File: {file_path}
Description: {description}

Code:
```
{code_content}
```

Provide your review following the APPROVED/CHANGES REQUIRED/REJECTED format."""
            }
        ]
    )
    
    return message.content[0].text

# Usage
review = review_code("src/auth.py", "Add OAuth2 support")
print(review)
```

---

## Advanced: Structured Output

Use Claude's structured output feature for programmatic access to review results:

```javascript
async function reviewWithStructuredOutput(code) {
  const qaSkill = loadSkill("qa-review");

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    system: qaSkill,
    messages: [
      {
        role: "user",
        content: `Review this code and respond with JSON.

Code:
${code}

Response format:
{
  "verdict": "APPROVED|CHANGES REQUIRED|REJECTED",
  "summary": "brief summary",
  "critical_issues": ["issue1", "issue2"],
  "major_issues": ["issue1"],
  "minor_issues": ["issue1"]
}`,
      },
    ],
  });

  return JSON.parse(response.content[0].text);
}
```

---

## Prompt Caching for Cost Optimization

For repeated reviews with the same skill:

```javascript
async function reviewWithCaching(fileList) {
  const qaSkill = loadSkill("qa-review");

  for (const file of fileList) {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: qaSkill,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Review: ${file.path}\n\n${file.content}`,
        },
      ],
    });

    console.log(response.content[0].text);
  }
}
```

This caches the skill definition, saving tokens on subsequent calls.

---

## Best Practices

1. **Cache skills when possible** — Load the skill once, use multiple times
2. **Handle errors gracefully** — Claude may occasionally format differently
3. **Stream long responses** — Use streaming for better UX in long reviews
4. **Version your skills** — Reference specific versions of skills (commit hash or tag)
5. **Log interactions** — Keep audit trails of all reviews for compliance

---

## Integration with Existing Systems

### With GitHub Actions

```yaml
name: Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run kyro-workflow code review
        run: |
          node scripts/review-pr.js
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### With GitLab CI

```yaml
code_review:
  image: node:18
  script:
    - node scripts/review-pr.js
  variables:
    ANTHROPIC_API_KEY: $CI_JOB_TOKEN
```

---

## Limitations & Considerations

- **Rate limits:** Respect Anthropic API rate limits when doing batch reviews
- **Cost:** Each review incurs API costs; consider caching and batching
- **Token limits:** Long files or reviews might hit token limits; split if needed
- **Determinism:** Claude's responses aren't fully deterministic; results may vary slightly

---

## Next Steps

1. Clone kyro-workflow repository
2. Set `ANTHROPIC_API_KEY` environment variable
3. Run example: `node examples/api-review.js`
4. Integrate into your CI/CD pipeline
5. Extend with custom scripts for your workflow

---

## Support

- **SDK Documentation:** https://github.com/anthropics/anthropic-sdk-python
- **Models & Pricing:** https://www.anthropic.com/pricing
- **Skill Documentation:** See `skills/qa-review/SKILL.md` and `skills/sprint-forge/SKILL.md`
