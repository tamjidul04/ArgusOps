# ArgusOps Local PC Agent Daemon & Test Harness

The ArgusOps Daemon suite provides ultra-lightweight, low-overhead background supervision, multi-agent file mutex coordination, and gateway governance for developer workstations (Windows, macOS, Linux).

---

## 1. Supervisor Daemon (`daemon/argus-daemon.mjs`)

A lightweight supervisor process consuming `< 35MB RAM` (strictly within the `< 150MB` PRD budget).

### Key Responsibilities:
- **3-Second Monitoring Cycle**: Continuously scans local coding processes (`Antigravity`, `Code.exe`, `claude`, `node`, `hermes`).
- **Real File Mutex Coordinator (`.argus-mutex.json`)**: Prevents two autonomous agents from overwriting the same file simultaneously by intercepting write conflicts in `< 100ms` and generating isolated conflict branches.
- **Zero-Trust Telemetry Heartbeats**: Streams resource telemetry (CPU, RAM, locked file paths) to `http://localhost:3000/api/brain` every 3 seconds while keeping all raw source code strictly local.
- **Embedded Local IPC HTTP Bridge**: Exposes port `41829` for sub-10ms local lock/unlock queries (`/status`, `/lock`, `/unlock`).

### Running the Supervisor Daemon:
```bash
# Standard mode (Monitors real host PC coding processes)
npm run daemon
# Or directly:
node daemon/argus-daemon.mjs
```

---

## 2. Autonomous Agent Test Harness (`daemon/run-live-agent.mjs`)

An interactive executable test script that acts as an autonomous coding agent communicating with the ArgusOps proxy gateway (`http://localhost:3000/api/v1/proxy`) using the default developer key (`argus_live_demo_key`).

### Lifecycle Execution Sequence:
1. **Step 1: File Mutex Lock & Frontier Architecture Step**
   - Acquires exclusive write lock on `src/app/dashboard/page.tsx` via `.argus-mutex.json`.
   - Demonstrates write collision interception when a second agent attempts concurrent write.
   - Executes high-complexity prompt (complexity score 88 >= 45) routed to the `FRONTIER` model tier (`claude-3-7-sonnet`).
2. **Step 2: Low-Complexity Task & Smart Model Downgrade**
   - Sends simple unit-test task with complexity score 20 < 45.
   - ArgusOps automatically downgrades model to `DOWNGRADED_FAST` (`claude-3-haiku`), burning 75% fewer tokens and saving money.
3. **Step 3: Shared Context Memory Cache Replay**
   - Re-sends duplicate project context from Step 1.
   - Triggers `CACHE HIT` with **0 tokens burned** and **+60,000 tokens saved** via SHA-256 memory cache replay.
4. **Step 4: Rogue Error-Retry Loop & Circuit Breaker Termination**
   - Enters repeated failing SQL migration tool calls 4 times in a row.
   - ArgusOps detects the loop in `< 100ms`, trips the Instant Circuit Breaker, returns **HTTP 429 Too Many Requests**, updates agent in database to `KILLED_LOOP` with 0 RAM / 0 CPU, and cleanly terminates the script.

### Running the Live Agent Test Script:
```bash
# Run the live autonomous agent demonstration
npm run agent:live
# Or directly:
node daemon/run-live-agent.mjs
```
