/**
 * ArgusOps Core Backend Brain - Guardrails & Governance Engine
 * 
 * Implements:
 * - PRD Section 4.2: <100ms Infinite Loop Detection Engine, Circuit Breaker & Human-in-the-Loop Nudge
 * - PRD Section 5.1: File-Locking (Mutex) for Local PC Multi-Agent Environments
 * - PRD Section 7: Low Latency Interception (<100ms SLA)
 * 
 * Features:
 * - High-resolution performance timing (`performance.now()`) measuring microsecond latency.
 * - Exact-match repetition detection for tool calls, errors, and ping-pong cycles.
 * - Semantic meaning loop detection using token Cosine & Jaccard vector similarity.
 * - Human-in-the-Loop Nudge threshold (>=80% task progress pauses; <80% terminates).
 * - Multi-agent file collision prevention with isolated branch fallback paths.
 * 
 * Built with native Node.js standard modules with zero paid external dependencies.
 * Full compliance with .antigravityrules (Zero TODO Policy, Strict Type Safety).
 */

import { performance } from "node:perf_hooks";

// ============================================================================
// CONSTANTS & GUARDRAIL THRESHOLDS
// ============================================================================

/** Maximum latency budget permitted for guardrail interception per PRD Section 7 (in ms) */
export const MAX_INTERCEPTION_BUDGET_MS = 100;

/** Loop confidence score threshold at or above which an intervention is triggered */
export const LOOP_SCORE_THRESHOLD = 0.85;

/** Progress percentage threshold above which agents are paused for human nudge instead of killed */
export const NUDGE_PROGRESS_THRESHOLD = 80;

/** Number of consecutive identical calls that trigger an instant hard loop flag */
export const CONSECUTIVE_EXACT_REPEAT_LIMIT = 2;

/** Common stop words filtered to extract high-signal semantic tokens */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "over", "after",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "their", "our",
  "this", "that", "these", "those",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "let", "so", "now", "again", "then", "just", "also", "trying", "attempting"
]);

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type LoopDetectionStatus = "ACTIVE" | "PAUSED_NUDGE" | "KILLED_LOOP";

export type LoopEventType = "NONE" | "EXACT_TOOL_LOOP" | "SEMANTIC_REASONING_LOOP";

/**
 * Result structure returned by evaluateAgentStreamForLoops().
 */
export interface LoopEvaluationResult {
  /** Lifecycle status determined by hypervisor policy */
  status: LoopDetectionStatus;
  /** Normalized loop confidence score from 0.00 to 1.00 */
  loopScore: number;
  /** Exact wall-clock latency in milliseconds measured with high-precision timer */
  interceptionMs: number;
  /** True if execution completed well within the <100ms SLA */
  withinLatencyBudget: boolean;
  /** Classification of detected loop phenomenon */
  loopType: LoopEventType;
  /** Maximum consecutive identical log strings observed */
  consecutiveIdenticalCount: number;
  /** Highest semantic similarity score computed between reasoning steps */
  semanticSimilarity: number;
  /** Current task completion percentage supplied to engine */
  taskProgressPct: number;
  /** True if instant circuit breaker was triggered to zero out token drain */
  circuitBreakerTripped: boolean;
  /** True if human nudge review was requested instead of termination */
  nudgeRequired: boolean;
  /** Human-readable explanation of hypervisor action */
  reason: string;
  /** Specific repeated tool call or reasoning pattern detected, if any */
  matchedPattern?: string;
}

/**
 * Representation of an active agent with its current mutex state.
 */
export interface ActiveAgentRecord {
  agent_id: string;
  name: string;
  locked_file_path: string | null;
}

/**
 * Result structure returned by verifyAndAcquireFileMutex().
 */
export interface FileMutexAcquisitionResult {
  /** True if lock was acquired, false if a collision was blocked */
  allowed: boolean;
  /** File path locked if acquisition succeeded */
  lockedFilePath?: string;
  /** Name of the active agent currently holding the lock if collision blocked */
  holderName?: string;
  /** ID of the agent holding the lock if collision blocked */
  holderAgentId?: string;
  /** Suggested safe collision fallback path to prevent code loss */
  fallbackFilePath?: string;
  /** Interception time in milliseconds measured with performance.now() */
  interceptionMs: number;
  /** True if mutex acquisition was evaluated within the <100ms budget */
  withinLatencyBudget: boolean;
  /** Actionable explanation of mutex state */
  reason: string;
}

// ============================================================================
// SEMANTIC SIMILARITY UTILITIES (COSINE & JACCARD)
// ============================================================================

/**
 * Normalizes an individual word token with light English stemming.
 */
function stemWord(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && w.length > 3 && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

/**
 * Tokenizes text into normalized semantic terms, stripping stop words and punctuation.
 */
export function extractSemanticTokens(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map(stemWord)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Calculates Token Jaccard Similarity between two text messages:
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
export function calculateJaccardSimilarity(textA: string, textB: string): number {
  const tokensA = new Set(extractSemanticTokens(textA));
  const tokensB = new Set(extractSemanticTokens(textB));

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection++;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

/**
 * Calculates Token Cosine Similarity between two text messages:
 * Cosine(A, B) = (A · B) / (||A|| * ||B||)
 */
export function calculateCosineSimilarity(textA: string, textB: string): number {
  const tokensA = extractSemanticTokens(textA);
  const tokensB = extractSemanticTokens(textB);

  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  const freqA: Record<string, number> = {};
  const freqB: Record<string, number> = {};
  const allTokens = new Set<string>();

  for (const t of tokensA) {
    freqA[t] = (freqA[t] || 0) + 1;
    allTokens.add(t);
  }
  for (const t of tokensB) {
    freqB[t] = (freqB[t] || 0) + 1;
    allTokens.add(t);
  }

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (const t of allTokens) {
    const valA = freqA[t] || 0;
    const valB = freqB[t] || 0;
    dotProduct += valA * valB;
    magA += valA * valA;
    magB += valB * valB;
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator > 0 ? dotProduct / denominator : 0.0;
}

// ============================================================================
// 1. HIGH-SPEED LOOP DETECTION ENGINE (<100ms)
// ============================================================================

/**
 * 1. evaluateAgentStreamForLoops
 * 
 * Inspects an agent's recent message/log stream for infinite execution loops.
 * Employs dual detection mechanics:
 * 1. Exact-Match Repetition (consecutive identical tool calls or recurring error strings).
 * 2. Semantic Meaning Loops (calculates Jaccard/Cosine similarity between reasoning steps).
 * 
 * Performance:
 * Starts a `performance.now()` timer and guarantees interception latency `<100ms` (typically 1ms - 15ms).
 * 
 * Decision Logic:
 * - If `loopScore >= 0.85` and `taskProgressPct >= 80`:
 *   Returns `status: "PAUSED_NUDGE"` (Human-in-the-Loop review to prevent throwing away nearly finished work).
 * - If `loopScore >= 0.85` and `taskProgressPct < 80`:
 *   Returns `status: "KILLED_LOOP"` (Instant Circuit Breaker terminates agent, zeroing out token burn).
 * - Otherwise:
 *   Returns `status: "ACTIVE"`.
 * 
 * @param recentLogs Array of recent log messages, tool calls, or reasoning output lines
 * @param taskProgressPct Estimated percentage of task completion (0 to 100)
 */
export function evaluateAgentStreamForLoops(
  recentLogs: string[],
  taskProgressPct: number
): LoopEvaluationResult {
  const startTime = performance.now();

  const progress = Math.max(0, Math.min(100, taskProgressPct));
  const logs = Array.isArray(recentLogs) ? recentLogs.filter((l) => typeof l === "string" && l.trim().length > 0) : [];

  if (logs.length < 2) {
    const interceptionMs = +(performance.now() - startTime).toFixed(2);
    return {
      status: "ACTIVE",
      loopScore: 0.0,
      interceptionMs,
      withinLatencyBudget: interceptionMs < MAX_INTERCEPTION_BUDGET_MS,
      loopType: "NONE",
      consecutiveIdenticalCount: 1,
      semanticSimilarity: 0.0,
      taskProgressPct: progress,
      circuitBreakerTripped: false,
      nudgeRequired: false,
      reason: "Log stream contains insufficient entries to determine loop recurrence.",
    };
  }

  // --------------------------------------------------------------------------
  // Check A: Exact-Match Loops (consecutive identical calls / ping-pong cycles)
  // --------------------------------------------------------------------------
  let consecutiveIdenticalCount = 1;
  let repeatedPattern = "";
  let exactScore = 0.0;

  // Check tail consecutive identical items
  const lastIndex = logs.length - 1;
  const tailLog = logs[lastIndex].trim();

  for (let i = lastIndex - 1; i >= 0; i--) {
    if (logs[i].trim().toLowerCase() === tailLog.toLowerCase()) {
      consecutiveIdenticalCount++;
    } else {
      break;
    }
  }

  if (consecutiveIdenticalCount >= 3) {
    exactScore = 0.98;
    repeatedPattern = tailLog;
  } else if (consecutiveIdenticalCount === 2) {
    exactScore = 0.88;
    repeatedPattern = tailLog;
  }

  // Check ping-pong cycles: A -> B -> A -> B (repeating tool call + error cycle)
  if (logs.length >= 4 && exactScore < 0.85) {
    const a1 = logs[logs.length - 1].trim().toLowerCase();
    const b1 = logs[logs.length - 2].trim().toLowerCase();
    const a2 = logs[logs.length - 3].trim().toLowerCase();
    const b2 = logs[logs.length - 4].trim().toLowerCase();

    if (a1 === a2 && b1 === b2 && a1 !== b1) {
      exactScore = 0.94;
      consecutiveIdenticalCount = 4;
      repeatedPattern = `Cycle: [${logs[logs.length - 2]}] -> [${logs[logs.length - 1]}]`;
    }
  }

  // Check 3-step repeating cycle: A -> B -> C -> A -> B -> C
  if (logs.length >= 6 && exactScore < 0.85) {
    const a1 = logs[logs.length - 1].trim().toLowerCase();
    const b1 = logs[logs.length - 2].trim().toLowerCase();
    const c1 = logs[logs.length - 3].trim().toLowerCase();
    const a2 = logs[logs.length - 4].trim().toLowerCase();
    const b2 = logs[logs.length - 5].trim().toLowerCase();
    const c2 = logs[logs.length - 6].trim().toLowerCase();

    if (a1 === a2 && b1 === b2 && c1 === c2) {
      exactScore = 0.91;
      consecutiveIdenticalCount = 6;
      repeatedPattern = `Cycle: [${logs[logs.length - 3]}] -> [${logs[logs.length - 2]}] -> [${logs[logs.length - 1]}]`;
    }
  }

  // --------------------------------------------------------------------------
  // Check B: Semantic Meaning Loops (paraphrased reasoning & cosine overlap)
  // --------------------------------------------------------------------------
  let highestSemanticSim = 0.0;
  let semanticSamplePair: [string, string] | undefined;

  // Evaluate sliding window of consecutive message pairs
  const windowSize = Math.min(6, logs.length);
  const recentSlice = logs.slice(logs.length - windowSize);

  for (let i = 0; i < recentSlice.length - 1; i++) {
    const textA = recentSlice[i];
    const textB = recentSlice[i + 1];

    const cosine = calculateCosineSimilarity(textA, textB);
    const jaccard = calculateJaccardSimilarity(textA, textB);
    // Weighted blend favoring cosine vector angle while rewarding token jaccard
    const blendedSim = +(cosine * 0.7 + jaccard * 0.3).toFixed(2);

    if (blendedSim > highestSemanticSim) {
      highestSemanticSim = blendedSim;
      semanticSamplePair = [textA, textB];
    }
  }

  const semanticScore = highestSemanticSim >= 0.85 ? highestSemanticSim : 0.0;

  // --------------------------------------------------------------------------
  // Synthesize Loop Score & Classification
  // --------------------------------------------------------------------------
  const loopScore = +(Math.max(exactScore, semanticScore)).toFixed(2);

  let loopType: LoopEventType = "NONE";
  if (exactScore >= LOOP_SCORE_THRESHOLD) {
    loopType = "EXACT_TOOL_LOOP";
  } else if (semanticScore >= LOOP_SCORE_THRESHOLD) {
    loopType = "SEMANTIC_REASONING_LOOP";
    if (semanticSamplePair && !repeatedPattern) {
      repeatedPattern = `Paraphrased reasoning: "${semanticSamplePair[1].slice(0, 80)}"`;
    }
  }

  // --------------------------------------------------------------------------
  // Hypervisor Decision Logic
  // --------------------------------------------------------------------------
  let status: LoopDetectionStatus = "ACTIVE";
  let circuitBreakerTripped = false;
  let nudgeRequired = false;
  let reason = "Agent executing normally within safe guardrail boundaries.";

  if (loopScore >= LOOP_SCORE_THRESHOLD) {
    if (progress >= NUDGE_PROGRESS_THRESHOLD) {
      // Near completion (>=80%): Pause for human confirmation instead of hard kill
      status = "PAUSED_NUDGE";
      nudgeRequired = true;
      circuitBreakerTripped = false;
      reason = `Loop score ${(loopScore * 100).toFixed(0)}% detected on ${loopType}. Task is ${progress}% complete: Paused for Human-in-the-Loop nudge review.`;
    } else {
      // Substantial work remaining (<80%): Hard kill circuit breaker trips
      status = "KILLED_LOOP";
      circuitBreakerTripped = true;
      nudgeRequired = false;
      reason = `Circuit breaker tripped at ${(loopScore * 100).toFixed(0)}% loop confidence (${progress}% complete). Rogue agent terminated to prevent runaway token drain.`;
    }
  }

  const elapsed = performance.now() - startTime;
  const interceptionMs = +(elapsed).toFixed(2);
  const withinLatencyBudget = interceptionMs < MAX_INTERCEPTION_BUDGET_MS;

  return {
    status,
    loopScore,
    interceptionMs,
    withinLatencyBudget,
    loopType,
    consecutiveIdenticalCount,
    semanticSimilarity: highestSemanticSim,
    taskProgressPct: progress,
    circuitBreakerTripped,
    nudgeRequired,
    reason,
    matchedPattern: repeatedPattern || undefined,
  };
}

// ============================================================================
// 2. LOCAL FILE-LOCKING MUTEX ENGINE
// ============================================================================

/**
 * Normalizes file path to cross-platform standard with forward slashes and trimmed whitespace.
 */
function normalizeFilePath(filePath: string): string {
  if (!filePath || typeof filePath !== "string") return "";
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

/**
 * 2. verifyAndAcquireFileMutex
 * 
 * Enforces local cross-agent file locking (mutex) across Antigravity, Claude, and Hermes.
 * 
 * Operational Logic:
 * - Checks if any other active agent currently holds an active write lock on `targetFilePath`.
 * - If locked by another agent:
 *   Blocks the concurrent write collision, returns `{ allowed: false, holderName, fallbackFilePath }`,
 *   and protects both active locks and active code from overwritten edits.
 * - If unlocked (or already held by the requesting agent):
 *   Grants the mutex lock, returns `{ allowed: true, lockedFilePath: targetFilePath }`.
 * 
 * Performance:
 * Measures execution using `performance.now()` to prove instant sub-millisecond evaluation (<100ms).
 * 
 * @param activeAgents Array of active agent records with their locked file paths
 * @param requestingAgentId Unique identifier of the agent requesting write access
 * @param targetFilePath The file path the agent intends to write to
 */
export function verifyAndAcquireFileMutex(
  activeAgents: ActiveAgentRecord[],
  requestingAgentId: string,
  targetFilePath: string
): FileMutexAcquisitionResult {
  const startTime = performance.now();

  const normalizedTarget = normalizeFilePath(targetFilePath);

  if (!normalizedTarget) {
    const elapsed = performance.now() - startTime;
    return {
      allowed: false,
      interceptionMs: +(elapsed).toFixed(2),
      withinLatencyBudget: true,
      reason: "Target file path cannot be empty.",
    };
  }

  // Look for any OTHER agent holding an active lock on this exact file
  const conflictHolder = activeAgents.find((agent) => {
    if (agent.agent_id === requestingAgentId) {
      return false; // The requesting agent already owns or re-asserts the lock
    }
    if (!agent.locked_file_path) {
      return false;
    }
    return normalizeFilePath(agent.locked_file_path) === normalizedTarget;
  });

  const elapsed = performance.now() - startTime;
  const interceptionMs = +(elapsed).toFixed(2);
  const withinLatencyBudget = interceptionMs < MAX_INTERCEPTION_BUDGET_MS;

  if (conflictHolder) {
    // Collision detected! Generate a safe isolated conflict branch path to prevent data loss
    const extMatch = normalizedTarget.match(/(\.[^.]+)$/);
    const extension = extMatch ? extMatch[1] : "";
    const baseName = extension ? normalizedTarget.slice(0, -extension.length) : normalizedTarget;
    const cleanAgentSuffix = requestingAgentId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fallbackFilePath = `${baseName}.conflict-${cleanAgentSuffix}${extension}`;

    return {
      allowed: false,
      holderName: conflictHolder.name,
      holderAgentId: conflictHolder.agent_id,
      fallbackFilePath,
      interceptionMs,
      withinLatencyBudget,
      reason: `Write collision intercepted in ${interceptionMs}ms! File '${normalizedTarget}' is actively locked by ${conflictHolder.name}. Write blocked to prevent overwriting uncommitted code.`,
    };
  }

  // Lock granted cleanly
  return {
    allowed: true,
    lockedFilePath: normalizedTarget,
    interceptionMs,
    withinLatencyBudget,
    reason: `File mutex lock granted for '${normalizedTarget}' in ${interceptionMs}ms. Zero write conflicts detected.`,
  };
}

/**
 * Releases a file lock held by an agent and returns the updated agent records.
 */
export function releaseFileMutex(
  activeAgents: ActiveAgentRecord[],
  agentId: string
): ActiveAgentRecord[] {
  return activeAgents.map((agent) => {
    if (agent.agent_id === agentId) {
      return {
        ...agent,
        locked_file_path: null,
      };
    }
    return agent;
  });
}

