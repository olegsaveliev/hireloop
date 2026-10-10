# Step N: <Agent name>

## Purpose
One sentence: what this agent does and why it matters.

## Trigger
What starts this step (previous step approved, button click, new reply arrived...).

## Inputs
Data the agent reads, and where it comes from (table / mock tool).

## Output
JSON schema the agent must return. Where it is saved.

## Model
Which Claude model and why.

## Tools
| Tool | Access | Purpose |
|------|--------|---------|

## Agent steps
Numbered list of what the agent does, in order.

## Human approval
- Who approves:
- What they see:
- What they can edit:
- On approve:
- On reject:
(Or "None" if this step runs without approval.)

## Guardrails
Things the agent must never do.

## Edge cases
What happens when input is missing, weird, or contradictory.

## Cost budget
- Budget: $X <unit, e.g. per candidate>
- Max agent turns: N
- Rationale: Why this number.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.

## Langfuse tracing
- Trace name:
- Tags:
- Metadata:
- Scores to record:

## Acceptance criteria
Checklist that must be true before the step counts as done.

## Test cases
3-5 concrete inputs and the expected behavior. These become the eval dataset in Langfuse.
