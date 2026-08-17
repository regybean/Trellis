# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker (GitHub Issues — the roles are plain **labels**, applied verbatim).

| Canonical role (skills) | Label in our tracker | Meaning                                  |
| ----------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`          | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`            | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`       | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`       | `ready-for-human`    | Requires human implementation            |
| `wontfix`               | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

**Roles are labels; lifecycle is issue state.** These triage labels are orthogonal to whether the issue is open or closed — `wontfix` is a label _and_ the issue gets closed; a done ticket is simply closed. Don't conflate the two (see the mapping table in [issue-tracker.md](./issue-tracker.md)).

Edit the right-hand column to match whatever vocabulary you actually use.
