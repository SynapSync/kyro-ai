# Idea Mode — Idea Maturation Pre-Scope

Mature a rough idea into a structured brief through a bounded, one-at-a-time conversation. Unlike `clarify.md` (which resolves ambiguity in an *existing* scope's `sprint.json`), this mode runs *before* any scope exists and produces one standalone markdown document as evidence, never touching `sprint.json` or `kyro.json`.

Routed when `/kyro:idea` is invoked (pre-scope, direct command route — not a `handoff.nextAction` value).

## Inputs

1. A rough one-line idea from the user (argument passed by `commands/idea.md`).
2. No prior files to read (no scope, no `sprint.json`, no `kyro.json`).

## The maturation loop

### Step 1 — Acknowledge and scope the loop

Acknowledge the idea in one clear sentence. State: "I'll ask you a few questions one at a time to flesh this out into a structured brief. You can answer freely or pick from options if I offer them. When we've got enough, I'll write it down and suggest starting a Kyro scope with it as the seed."

### Step 2 — Ask questions (one at a time, bounded)

Ask questions sequentially, cherry-picked for relevance to the idea:

**Preferred question trajectory** (order varies by idea):
1. **What's the core problem or motivation?** (Why build this? What itch does it scratch?)
2. **Who is this for?** (End users, internal team, yourself, stakeholders?)
3. **What does success look like?** (How will you know it worked? What's the win?)
4. **What's explicitly out of scope?** (What are you *not* doing?)
5. **Are there hard constraints?** (Timeline, budget, tech limits, compliance, team size?)
6. **Anything else critical we haven't touched?** (Soft limit checkpoint — if no, move to Step 3; if yes, ask it and then move to Step 3.)

**Question mechanics:**
- **One question per turn.** Stop and wait for the answer before the next.
- Prefer multiple-choice (2–5 mutually exclusive options, recommended option first) when possible. Otherwise, ask for a short answer, explicitly constrained: "answer in ≤3 sentences" or similar.
- Never invent details to fill gaps. If the user's answer is vague, that's valid — hold it as-is and flag it in the document later as `[OPEN QUESTION: ...]`.
- Listen for done-signals even mid-conversation (see Step 3 exit condition).

### Step 3 — Exit conditions (any one triggers the write)

Stop asking and move to Step 4 (write the document) if **any** of these is true:

- **User signals done explicitly.** Common signals: "listo", "eso es", "write it", "hazlo", "let's go", "good enough", vamos a eso".
- **Six questions asked.** At question 6, propose writing instead of continuing: "I think we've got the core idea solid. Ready for me to write it, or do you want to refine anything else?"
- **Ten conversational turns reached.** Hard stop — write the document with whatever is known, flagging unknowns as `[OPEN QUESTION: ...]`.
- **You judge the idea now has a clear trajectory.** Problem + audience + rough scope boundary + at least one success signal = enough to write. If you sense that continuing will just add marginal detail (not material shape changes), offer the write option.

### Step 4 — Confirm docType and filename

Before writing, confirm with the user in one line which `docType` and filename are about to be created. Infer `docType` by the shape of the conversation, state it, and allow override:

> "I'll write this as a **plan** at `.agents/kyro/plan/2026-07-08-mario-kart-game.md`. If you'd rather call it an **analysis** or something else, say so now. Otherwise, I'll write it."

**`docType` inference rules:**
- **`plan`** (default): the conversation committed to building/shipping something concrete. Use this unless a reason below applies.
- **`analysis`**: the conversation was exploratory, comparing options, or assessing viability — no firm commitment to build.
- **`constitution`**: the conversation was about durable, project-wide ground rules or principles the user wants captured as prose before they become `kyro.json.principles[]` later (explicitly kept separate from `principles[]` per the design constraint).

Wait for the user's confirmation or override before proceeding to Step 5.

### Step 5 — Write the document (one and only one write)

Once confirmed, perform exactly **one file write** to `.agents/kyro/{docType}/{date}-{slug}.md`:

- **Path structure:** `.agents/kyro/` must exist (the Kyro directory root); if not, create it. Then create the `{docType}` subdirectory if it doesn't exist (e.g. `plan/`, `analysis/`, `constitution/`). Write the file inside.
- **Filename:** `{YYYY-MM-DD}-{slug}.md` where date is today (in `YYYY-MM-DD` format, e.g. `2026-07-08`) and slug is a kebab-case 3–6 word summary of the idea (e.g. `mario-kart-game`, `llm-training-viability`).
- **Template:** use `skills/sprint-forge/assets/templates/matured-idea.md`, filling in all fields and sections from the conversation.
  - If a section has no answer (e.g. "Explicitly out of scope" was never discussed), write "`[NOT DISCUSSED]`" instead of inventing.
  - If a question is unresolved (hard-limit exit), mark it as "`[OPEN QUESTION: <what was unclear>]`" in the relevant section or in a dedicated `## Open questions` section.
  - Never write to `kyro.json` or touch `principles[]` — this is evidence, not a schema mutation.

After the write succeeds, output: "Written to `.agents/kyro/{docType}/{date}-{slug}.md`."

### Step 6 — Suggest next steps

After the write, suggest the natural next step in one paragraph:

> "You now have a matured brief. When you're ready, run `/kyro:forge mario-kart-game` (or `/kyro:forge` and then reference `.agents/kyro/plan/2026-07-08-mario-kart-game.md` as the seed for your scope's objective). Kyro's INIT mode will read your brief and use it as richer context than a one-liner. You can also skip `/kyro:debate` altogether and go straight to `/kyro:forge` if you prefer — both paths are equally valid."

## Rules

- **Write-only, one shot.** Never re-read the `.agents/kyro/{docType}/` directory or these documents to route; they are pure evidence. `doctor` and `analyze` never validate them (they run only on `sprint.json`, not project-level docs).
- **No schema mutations.** Never write to or read `kyro.json`, `sprint.json`, or `principles[]`. No CLI validators or hooks touch this mode's outputs.
- **No guessing.** If a question isn't answered, mark it as `[OPEN QUESTION]` in the document and move on. Do not invent.
- **Admit unknowns.** Unlike `clarify.md` (which forbids `[NEEDS CLARIFICATION]` markers in the routed artifact), this document is pure evidence — `[OPEN QUESTION]` is fine and expected if the idea was still forming during the conversation.
