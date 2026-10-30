# ArgusOps Local PC Agent Daemon

The ArgusOps Daemon is a lightweight, low-overhead background supervisor and coordinator designed to run locally on developer workstations (Windows, macOS, Linux).

## Key Objectives
- **Memory Footprint**: Strictly constrained to `< 150MB RAM`.
- **Low-Latency Interception**: Evaluates agent tool calls and file lock requests in `< 100ms`.
- **Multi-Agent Coordination**: Coordinates local coding agents (such as Claude, Antigravity, and Hermes) to prevent conflicting file edits and duplicate work.
- **Resource Governance**: Continuously monitors local agent CPU, memory, and loop conditions; triggers instant circuit-breakers or human-in-the-loop nudges if an agent enters an infinite error loop.
- **Privacy First**: Zero-trust architecture. Local source code never leaves the developer's workstation without explicit consent.

## Architecture
- `types.ts`: Core data structures and interface definitions.
- `config.ts`: Resource thresholds, heartbeat rates, and IPC port settings.

