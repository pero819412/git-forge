# git-forge — a standalone GitHub-compatible git forge

[![make.fun bounty](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/pero819412/git-forge/rank.svg)](https://make.fun/bounty/github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/pero819412/git-forge/reward.svg)](https://make.fun/bounty/github-core-clone-01)

An entry for the make.fun bounty [Build a GitHub core clone](https://make.fun/bounty/github-core-clone-01): one Node process, standard library only — no git binary, no packages, no network — serving four surfaces over its own in-memory store:

- **Git smart HTTP** (v0 advertise + v2 ls-refs): clone, fetch (shallow / deepen / incremental), push with ofs/ref delta support, non-fast-forward rejection, sideband report-status. Objects are content-addressed by SHA-1 and served byte-exact.
- **REST v3**: repositories (CRUD, branches, commits, contents API with sha checks), issues (labels, comments, sorting), pull requests (files/diff against the merge base, three-way merge with conflict detection, deterministic merge commits).
- **GraphQL**: repository / issue / pullRequest queries, global node IDs, cursor-paginated connections, mutations, introspection.
- **MCP**: JSON-RPC tools (create issue, list issues, create pull request, merge pull request) sharing the exact domain functions of the REST surface, so parity is structural.

## Determinism

The forge never reads the wall clock or a random source for anything stored or returned: a logical clock stamps every timestamp and ID, and git SHAs derive from content only. Replaying the same scenario produces a byte-identical state export.

## Layout

- `main.ts` — harness lifecycle (fixed by the competition starter)
- `app.ts` — HTTP routing and surface wiring
- `git-store.ts` — object store, refs, pack read/write, merge machinery
- `git-http.ts` — smart HTTP transport
- `git-rest.ts` — REST v3 surface
- `graphql.ts` — GraphQL endpoint
- `mcp.ts` — MCP endpoint
- `tests/` — in-process verification adapters and stage notes

## Local verification

Built and checked against the public conformance kit for `github-core-clone-01`: all 120 conformance checks pass locally (git 30, repos 15, issues 15, pulls 20, graphql 20, mcp 15, protocol 5), with the four timed workloads ahead of the published reference times.

## License

MIT — see `LICENSE`.
