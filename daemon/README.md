# daemon/ (legacy prototype)

`argus-daemon.mjs` is the original process scanner. It predates account authentication: it posts to `/api/brain` without an API key, so the server now rejects it with 401, and it only observed processes (it could not pause or stop them).

It is being replaced by the `argus` CLI (`argus run <agent>`), which starts the agent itself so pause, resume and stop actually work, and authenticates with an API key. See [.gsd/ROADMAP.md](../.gsd/ROADMAP.md), Phase 1.

The earlier `run-live-agent.mjs` demo harness was removed because it depended on a built-in demo API key and simulated incidents.
