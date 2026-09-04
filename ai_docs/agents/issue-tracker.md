# Issue tracker: GitHub

Issues and specs for `askgina/plugins` live in this repository's GitHub Issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** Set this to `yes` only if the repository later treats external pull requests as feature requests.

When enabled, pull requests use the corresponding `gh pr` operations. GitHub shares one number space across issues and pull requests, so resolve an ambiguous `#42` with `gh pr view 42` and fall back to `gh issue view 42`.

## Skill operations

- When a skill says **publish to the issue tracker**, create a GitHub issue.
- When a skill says **fetch the relevant ticket**, run `gh issue view <number> --comments`.

## Wayfinding operations

The Wayfinder map is a GitHub issue labelled `wayfinder:map`; its decision tickets are child issues.

- **Map**: create one issue with `wayfinder:map`, containing Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket**: create an issue labelled with exactly one ticket type: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Link it to the map with GitHub's sub-issues API. If sub-issues are unavailable, add the child to a task list in the map and put `Part of #<map>` at the top of the child body.
- **Sub-issue identity**: obtain the child's numeric database id with `gh api repos/askgina/plugins/issues/<child> --jq .id`, then pass that integer to the map's sub-issues endpoint. Do not pass the issue number or GraphQL node id.
- **Blocking**: use GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/askgina/plugins/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database id. If dependencies are unavailable, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body.
- **Frontier**: list the map's open children, then exclude tickets with an open blocker or assignee. The first remaining child in map order is the next ticket.
- **Claim**: assign the ticket before doing work with `gh issue edit <number> --add-assignee @me`.
- **Resolve**: post the decision as a resolution comment, close the ticket, then append only a gist and link to the map's Decisions so far.

The repository labels `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, and `wayfinder:task` are the canonical Wayfinder vocabulary.
