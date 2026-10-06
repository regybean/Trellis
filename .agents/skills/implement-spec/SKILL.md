---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch in its own worktree: call the **EnterWorktree** tool (name it `<spec-slug>`), then bootstrap it per [worktree-workflow.md](docs/agents/worktree-workflow.md). Don't open a PR yet; this repo never opens drafts (see [pull-requests.md](docs/agents/pull-requests.md)).

4. Use **implementer subagents** to implement each ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - bootstraps its worktree per [worktree-workflow.md](docs/agents/worktree-workflow.md) (no hook fires for a subagent worktree here);
   - calls the Skill tool with `tdd` to build the ticket, running the per-package incremental check for what it touched (see [quality-gate.md](docs/agents/quality-gate.md));
   - commits per [implement](.agents/skills/implement/SKILL.md)'s commit style, citing its ticket;
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, call the Skill tool with `code-review` on the integration branch. Fix all issues raised by the code review in a single **implementer subagent**.

8. Run the full gate on the integration branch per [quality-gate.md](docs/agents/quality-gate.md). Don't move on until it's green.

9. Open one PR from the integration branch per [pull-requests.md](docs/agents/pull-requests.md), with one `Closes` line per ticket it finishes and none for the spec itself. Never auto-merge; merge is the human's call.

10. Clean up all **implementer subagent** worktrees, then retire the integration worktree per [worktree-workflow.md](docs/agents/worktree-workflow.md#retire) once the PR is confirmed open.
