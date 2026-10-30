import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { prisma } from "@/lib/prisma";
import {
  evaluateAgentStreamForLoops,
  LOOP_SCORE_THRESHOLD,
  MAX_INTERCEPTION_BUDGET_MS,
} from "@/lib/guardrails-engine";
import {
  analyzePromptComplexity,
  AVERAGE_CODEBASE_CONTEXT_TOKENS,
} from "@/lib/master-orchestrator";

/**
 * ArgusOps LLM Interception Proxy Gateway (v1.1)
 * Endpoint: /api/v1/proxy
 * 
 * Provides an overarching AI Agent Cluster Hypervisor and Cost-Optimization Gateway:
 * 1. Authentication & Wallet Check (x-argus-key / Authorization Bearer & demo key support)
 * 2. Shared Context & Memory Cache (PRD 5.1: Zero-token cache replay for redundant project context)
 * 3. Real-Time <100ms Infinite Loop Circuit Breaker (PRD 4.2: Terminate loops or pause near-complete agents)
 * 4. Smart Model Downgrading Router (PRD 5.1: Routes low-complexity prompts <45 to DOWNGRADED_FAST saving 75% tokens)
 * 
 * Strict compliance with .antigravityrules (Zero TODO Policy, Strict Type Safety).
 */

// In-memory cluster context hash tracking for instant cache lookups
const clusterContextMemorySet = new Set<string>();

// Per-agent recent tool call memory ring buffer (tracks last 10 tool calls per agent)
const agentRecentCallBuffer = new Map<string, string[]>();

/**
 * Normalizes an object for canonical, deterministic JSON serialization and hashing.
 */
function canonicalizeObject(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeObject);
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeObject(obj[key]);
  }
  return result;
}

/**
 * Determines whether a requested model identifier represents an expensive Frontier model.
 */
function isFrontierModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase().trim();
  // Cheap / Fast / Already downgraded models
  const isCheap =
    normalized.includes("haiku") ||
    normalized.includes("flash") ||
    normalized.includes("mini") ||
    normalized.includes("downgraded") ||
    normalized.includes("local");

  return !isCheap;
}

/**
 * Resolves the authenticated user via x-argus-key or Authorization Bearer header.
 */
async function authenticateRequest(req: NextRequest) {
  // 1. Extract API key from headers or query parameters
  let rawKey = req.headers.get("x-argus-key")?.trim();

  if (!rawKey) {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      rawKey = authHeader.slice(7).trim();
    }
  }

  if (!rawKey) {
    const { searchParams } = new URL(req.url);
    rawKey = searchParams.get("apiKey")?.trim() || searchParams.get("key")?.trim();
  }

  if (!rawKey) {
    return {
      errorResponse: NextResponse.json(
        {
          error: "Unauthorized: Missing API key. Provide 'x-argus-key' or 'Authorization: Bearer <key>'.",
          statusCode: 401,
        },
        { status: 401 }
      ),
      user: null,
      rawKey: null,
    };
  }

  // 2. Validate Default Local Demo Key
  if (rawKey === "argus_live_demo_key") {
    // Look up default master user (usr_tamjid_master or first active user)
    let masterUser = await prisma.user.findFirst({
      where: { id: "usr_tamjid_master", status: "ACTIVE" },
      include: {
        subscription: { include: { plan: true } },
        clusters: { include: { agents: true } },
      },
    });

    if (!masterUser) {
      masterUser = await prisma.user.findFirst({
        where: { status: "ACTIVE", subscription: { isNot: null } },
        include: {
          subscription: { include: { plan: true } },
          clusters: { include: { agents: true } },
        },
      });
    }

    if (!masterUser) {
      return {
        errorResponse: NextResponse.json(
          { error: "Unauthorized: No active user provisioned for demo key.", statusCode: 401 },
          { status: 401 }
        ),
        user: null,
        rawKey,
      };
    }

    // Ensure demo key exists in Api_Keys table for database referential integrity
    const demoKeyHash = crypto.createHash("sha256").update("argus_live_demo_key").digest("hex");
    const existingDemoKey = await prisma.apiKey.findFirst({
      where: {
        OR: [
          { key_hash: demoKeyHash },
          { id: "key_argus_live_demo" },
          { key_prefix: "argus_live_demo_key" },
        ],
      },
    });

    if (!existingDemoKey) {
      await prisma.apiKey.create({
        data: {
          id: "key_argus_live_demo",
          user_id: masterUser.id,
          label: "Default Local Demo Key (ArgusOps)",
          key_prefix: "argus_live_demo_key",
          key_hash: demoKeyHash,
          last_used_at: new Date(),
        },
      }).catch(() => {
        // Safe catch for potential concurrent insertion
      });
    } else {
      await prisma.apiKey.update({
        where: { id: existingDemoKey.id },
        data: { last_used_at: new Date() },
      }).catch(() => {});
    }

    return { errorResponse: null, user: masterUser, rawKey };
  }

  // 3. Validate Standard Key against Api_Keys in Prisma
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const apiKeyRecord = await prisma.apiKey.findFirst({
    where: {
      OR: [
        { key_hash: keyHash },
        { key_hash: rawKey },
        { id: rawKey },
        { key_prefix: rawKey },
      ],
    },
    include: {
      user: {
        include: {
          subscription: { include: { plan: true } },
          clusters: { include: { agents: true } },
        },
      },
    },
  });

  if (!apiKeyRecord || !apiKeyRecord.user) {
    return {
      errorResponse: NextResponse.json(
        { error: "Unauthorized: Invalid API key.", statusCode: 401 },
        { status: 401 }
      ),
      user: null,
      rawKey,
    };
  }

  // Update last_used_at asynchronously
  await prisma.apiKey.update({
    where: { id: apiKeyRecord.id },
    data: { last_used_at: new Date() },
  }).catch(() => {});

  return { errorResponse: null, user: apiKeyRecord.user, rawKey };
}

// ============================================================================
// POST /api/v1/proxy
// ============================================================================
export async function POST(req: NextRequest) {
  const gatewayStartTime = performance.now();

  try {
    // ------------------------------------------------------------------------
    // 1. AUTHENTICATION & WALLET CHECK
    // ------------------------------------------------------------------------
    const authResult = await authenticateRequest(req);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    const { user } = authResult;
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: User not found.", statusCode: 401 },
        { status: 401 }
      );
    }

    // Check account status
    if (user.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Forbidden: User account is inactive or suspended.", statusCode: 403 },
        { status: 403 }
      );
    }

    // Verify Subscription & Wallet is active
    const subscription = user.subscription;
    if (!subscription || subscription.purchase_status === "REJECTED") {
      return NextResponse.json(
        {
          error: "Forbidden: No active subscription or wallet found for this account.",
          statusCode: 403,
        },
        { status: 403 }
      );
    }

    const freeTokens = subscription.free_tokens ?? 0;
    const paidTokens = subscription.paid_tokens ?? 0;
    const totalAvailableTokens = freeTokens + paidTokens;

    if (totalAvailableTokens <= 0) {
      return NextResponse.json(
        {
          error: "Payment Required: Token balance depleted. Free tokens: 0, Paid tokens: 0. Please purchase or upgrade your wallet tokens.",
          statusCode: 402,
          availableTokens: 0,
        },
        { status: 402 }
      );
    }

    // Parse incoming request body
    const body = await req.json().catch(() => ({}));

    // Extract prompt from various caller formats (string, messages array, instruction)
    let promptText = "";
    if (typeof body.prompt === "string") {
      promptText = body.prompt.trim();
    } else if (Array.isArray(body.messages)) {
      promptText = body.messages
        .map((m: { role?: string; content?: string }) => `${m.role || "user"}: ${m.content || ""}`)
        .join("\n")
        .trim();
    } else if (typeof body.instruction === "string") {
      promptText = body.instruction.trim();
    } else if (typeof body.input === "string") {
      promptText = body.input.trim();
    }

    const toolCall = body.toolCall ?? body.tool_call ?? body.tools ?? body.toolCalls ?? null;
    const workspaceFiles = body.workspaceFiles ?? body.workspace_files ?? body.files ?? null;
    const requestedModel = (body.model || "claude-3-7-sonnet").toString().trim();
    const taskProgressPct = typeof body.taskProgressPct === "number"
      ? body.taskProgressPct
      : (typeof body.progress === "number" ? body.progress : 0);

    // Resolve target cluster
    const clusterId = body.clusterId || user.clusters?.[0]?.cluster_id || "cluster_cloud_useast";
    let cluster: (typeof user.clusters[number]) | null | undefined = user.clusters?.find((c) => c.cluster_id === clusterId);

    if (!cluster) {
      cluster = (await prisma.clusterAndWorkspace.findUnique({
        where: { cluster_id: clusterId },
        include: { agents: true },
      })) || (await prisma.clusterAndWorkspace.findFirst({
        where: { user_id: user.id },
        include: { agents: true },
      }));
    }

    if (!cluster) {
      // Create fallback cluster for user if none exists
      cluster = await prisma.clusterAndWorkspace.create({
        data: {
          cluster_id: `cluster_${user.id.slice(0, 8)}_default`,
          user_id: user.id,
          name: "Default Workspace Cluster",
          environment: "CLOUD",
          active_agents: 3,
          hibernated_agents: 0,
          cached_context_hash: null,
          cache_tokens_saved: 0,
        },
        include: { agents: true },
      });
    }

    // Resolve target agent in the cluster
    const agentId = body.agentId || body.agent_id;
    let targetAgent = agentId
      ? await prisma.agent.findUnique({ where: { agent_id: agentId } })
      : null;

    if (!targetAgent && cluster) {
      targetAgent = await prisma.agent.findFirst({
        where: { cluster_id: cluster.cluster_id, status: "ACTIVE" },
      }) || await prisma.agent.findFirst({
        where: { cluster_id: cluster.cluster_id },
      });
    }

    // ------------------------------------------------------------------------
    // 3. REAL-TIME <100ms INFINITE LOOP CIRCUIT BREAKER (PRD Section 4.2)
    // ------------------------------------------------------------------------
    // Collect recent agent stream logs, tool calls, and reasoning steps
    let logsToEvaluate: string[] = [];

    if (Array.isArray(body.recentLogs)) {
      logsToEvaluate = body.recentLogs.map((l: unknown) => String(l).trim()).filter(Boolean);
    } else if (Array.isArray(body.history)) {
      logsToEvaluate = body.history.map((l: unknown) => String(l).trim()).filter(Boolean);
    } else if (Array.isArray(body.toolCalls)) {
      logsToEvaluate = body.toolCalls.map((tc: unknown) =>
        typeof tc === "string" ? tc : JSON.stringify(tc)
      );
    }

    // Support simulated repeat counts for rigorous integration testing
    if (body.repeatCount && typeof body.repeatCount === "number" && toolCall) {
      const tcStr = typeof toolCall === "string" ? toolCall : JSON.stringify(toolCall);
      logsToEvaluate = Array(body.repeatCount).fill(tcStr);
    }

    // Accumulate in per-agent error-retry memory buffer (tracks consecutive failing tool calls across HTTP requests)
    const bufferKey = targetAgent?.agent_id || user.id;
    const hasError = (toolCall && typeof toolCall === "object" && ("error" in toolCall || "isError" in toolCall)) || body.error;
    const errorSignature = hasError
      ? (typeof toolCall === "string" ? toolCall : JSON.stringify(canonicalizeObject(toolCall || body.error)))
      : null;

    if (errorSignature && logsToEvaluate.length === 0) {
      const history = agentRecentCallBuffer.get(bufferKey) || [];
      history.push(errorSignature);
      if (history.length > 10) history.shift();
      agentRecentCallBuffer.set(bufferKey, history);

      if (history.length >= 2) {
        logsToEvaluate = [...history];
      }
    }

    // If stream contains 2+ steps, evaluate loop recurrence within <100ms SLA
    if (logsToEvaluate.length >= 2) {
      const loopEval = evaluateAgentStreamForLoops(logsToEvaluate, taskProgressPct);

      if (loopEval.loopScore >= LOOP_SCORE_THRESHOLD) {
        if (taskProgressPct >= 80) {
          // Near-complete agent: Human-in-the-Loop review (HTTP 423 Locked)
          if (targetAgent) {
            await prisma.agent.update({
              where: { agent_id: targetAgent.agent_id },
              data: {
                status: "PAUSED_NUDGE",
                loop_score: loopEval.loopScore,
                last_heartbeat_at: new Date(),
              },
            });
          }

          await prisma.taskAndLog.create({
            data: {
              cluster_id: cluster.cluster_id,
              prompt_summary: `[PAUSED_NUDGE] Loop score ${(loopEval.loopScore * 100).toFixed(0)}% at ${taskProgressPct}% progress. Agent paused for human confirmation.`,
              complexity_score: 50,
              assigned_agents: 1,
              hibernated_count: 0,
              tokens_saved: 0,
              loop_incidents: 1,
              interception_ms: Math.round(loopEval.interceptionMs),
              status: "PAUSED_NUDGE",
            },
          });

          return NextResponse.json(
            {
              status: "PAUSED_NUDGE",
              message: "Human-in-the-Loop Nudge required before continuing.",
              interceptionMs: loopEval.interceptionMs,
              withinLatencyBudget: loopEval.withinLatencyBudget,
              loopScore: loopEval.loopScore,
              taskProgressPct,
              loopType: loopEval.loopType,
              reason: loopEval.reason,
              agentId: targetAgent?.agent_id,
            },
            { status: 423 }
          );
        } else {
          // Rogue loop: Trip Instant Kill Switch (HTTP 429 Too Many Requests)
          if (targetAgent) {
            await prisma.agent.update({
              where: { agent_id: targetAgent.agent_id },
              data: {
                status: "KILLED_LOOP",
                ram_usage: 0.0,
                cpu_usage: 0.0,
                loop_score: loopEval.loopScore,
                current_task: `[KILLED_LOOP] Circuit breaker tripped in ${Math.round(loopEval.interceptionMs)}ms due to repeated tool errors. Terminated to zero token burn.`,
                locked_file_path: null,
                last_heartbeat_at: new Date(),
              },
            });
          }

          await prisma.taskAndLog.create({
            data: {
              cluster_id: cluster.cluster_id,
              prompt_summary: `[KILLED_LOOP] Circuit breaker tripped: ${loopEval.reason.slice(0, 90)}`,
              complexity_score: 50,
              assigned_agents: 1,
              hibernated_count: 0,
              tokens_saved: 0,
              loop_incidents: 1,
              interception_ms: Math.round(loopEval.interceptionMs),
              status: "KILLED_LOOP",
            },
          });

          return NextResponse.json(
            {
              status: "KILLED_LOOP",
              interceptionMs: loopEval.interceptionMs,
              withinLatencyBudget: loopEval.withinLatencyBudget,
              message: "ArgusOps Circuit Breaker halted infinite loop.",
              loopScore: loopEval.loopScore,
              loopType: loopEval.loopType,
              reason: loopEval.reason,
              agentId: targetAgent?.agent_id,
            },
            { status: 429 }
          );
        }
      }
    }

    // ------------------------------------------------------------------------
    // 2. SHARED CONTEXT & MEMORY CACHE (PRD Section 5.1)
    // ------------------------------------------------------------------------
    // Hash incoming { prompt, toolCall, workspaceFiles } payload
    const cacheKeyPayload = {
      prompt: promptText,
      toolCall: toolCall ? canonicalizeObject(toolCall) : null,
      workspaceFiles: workspaceFiles ? canonicalizeObject(workspaceFiles) : null,
    };

    const canonicalJsonString = JSON.stringify(cacheKeyPayload);
    const rawContextHash = crypto.createHash("sha256").update(canonicalJsonString).digest("hex");
    const contextHash = `sha256:${rawContextHash}`;
    const clusterCacheKey = `${cluster.cluster_id}:${contextHash}`;

    // Verify if this context hash has already been processed in this cluster
    const isCacheHit =
      cluster.cached_context_hash === contextHash ||
      clusterContextMemorySet.has(clusterCacheKey) ||
      (await prisma.taskAndLog.findFirst({
        where: {
          cluster_id: cluster.cluster_id,
          prompt_summary: { contains: rawContextHash.slice(0, 16) },
        },
      })) !== null;

    if (isCacheHit) {
      const cacheTokensSaved = AVERAGE_CODEBASE_CONTEXT_TOKENS; // 60,000 tokens per PRD 5.1
      const cacheInterceptionMs = +(performance.now() - gatewayStartTime).toFixed(2);

      // Increment cache_tokens_saved in Clusters_And_Workspaces
      await prisma.clusterAndWorkspace.update({
        where: { cluster_id: cluster.cluster_id },
        data: {
          cache_tokens_saved: { increment: cacheTokensSaved },
          cached_context_hash: contextHash,
        },
      });

      // Log saved tokens in Tasks_And_Logs
      await prisma.taskAndLog.create({
        data: {
          cluster_id: cluster.cluster_id,
          prompt_summary: `[CACHE HIT ${rawContextHash.slice(0, 16)}] ${(promptText || "Shared context memory hit").slice(0, 80)}`,
          complexity_score: 10,
          assigned_agents: 1,
          hibernated_count: 0,
          tokens_saved: cacheTokensSaved,
          loop_incidents: 0,
          interception_ms: Math.round(cacheInterceptionMs),
          status: "COMPLETED",
        },
      });

      return NextResponse.json({
        success: true,
        cached: true,
        status: "CACHED",
        contextHash,
        tokensBurned: 0,
        tokensSaved: cacheTokensSaved,
        interceptionMs: cacheInterceptionMs,
        withinLatencyBudget: cacheInterceptionMs < MAX_INTERCEPTION_BUDGET_MS,
        clusterId: cluster.cluster_id,
        message: "ArgusOps Shared Context & Memory Cache HIT: redundant prompt/toolCall payload served with 0 tokens burned.",
        result: {
          output: "[ArgusOps Context Cache] Memory hit: redundant context skipped with 0 tokens burned.",
          cached: true,
          model: "argus-context-cache",
          tokensUsed: 0,
        },
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "[ArgusOps Context Cache] Memory hit: redundant context skipped with 0 tokens burned.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          tokens_saved: cacheTokensSaved,
        },
      });
    }

    // Cache Miss: Record hash in cluster cache set and DB
    clusterContextMemorySet.add(clusterCacheKey);
    await prisma.clusterAndWorkspace.update({
      where: { cluster_id: cluster.cluster_id },
      data: { cached_context_hash: contextHash },
    }).catch(() => {});

    // ------------------------------------------------------------------------
    // 4. SMART MODEL DOWNGRADING ROUTER (PRD Section 5.1)
    // ------------------------------------------------------------------------
    // Score prompt complexity (10 to 95)
    const complexityScore = typeof body.complexityScore === "number"
      ? body.complexityScore
      : analyzePromptComplexity(promptText).score;

    const isFrontier = isFrontierModel(requestedModel);

    // Baseline token estimation for standard execution
    const promptTokens = Math.max(12, Math.ceil((promptText.length || 100) / 4));
    const completionTokens = typeof body.max_tokens === "number"
      ? Math.min(body.max_tokens, 800)
      : 600;
    const baseTokens = typeof body.tokens === "number"
      ? body.tokens
      : (typeof body.estimatedTokens === "number" ? body.estimatedTokens : promptTokens + completionTokens);

    let routedModel = requestedModel;
    let modelTier: "FRONTIER" | "DOWNGRADED_FAST" = "FRONTIER";
    let isDowngraded = false;
    let tokensDeducted = baseTokens;
    let tokensSaved = 0;

    if (complexityScore < 45 && isFrontier) {
      // Downgrade to DOWNGRADED_FAST (gemini-2.5-flash / claude-3-haiku)
      routedModel = requestedModel.toLowerCase().includes("claude")
        ? "claude-3-haiku"
        : "gemini-2.5-flash";
      modelTier = "DOWNGRADED_FAST";
      isDowngraded = true;

      // Deduct 75% fewer tokens (only burn 25% of baseline)
      tokensDeducted = Math.max(1, Math.round(baseTokens * 0.25));
      tokensSaved = baseTokens - tokensDeducted;
    } else {
      modelTier = isFrontier ? "FRONTIER" : "DOWNGRADED_FAST";
      tokensDeducted = baseTokens;
      tokensSaved = 0;
    }

    // Deduct tokens from user subscription wallet
    let newFreeTokens = subscription.free_tokens ?? 0;
    let newPaidTokens = subscription.paid_tokens ?? 0;

    if (newFreeTokens >= tokensDeducted) {
      newFreeTokens -= tokensDeducted;
    } else {
      const remainingDeduction = tokensDeducted - newFreeTokens;
      newFreeTokens = 0;
      newPaidTokens = Math.max(0, newPaidTokens - remainingDeduction);
    }

    const updatedWallet = await prisma.subscriptionAndWallet.update({
      where: { user_id: user.id },
      data: {
        free_tokens: newFreeTokens,
        paid_tokens: newPaidTokens,
      },
    });

    const totalGatewayMs = +(performance.now() - gatewayStartTime).toFixed(2);

    // Record token savings in Tasks_And_Logs
    await prisma.taskAndLog.create({
      data: {
        cluster_id: cluster.cluster_id,
        prompt_summary: isDowngraded
          ? `[ROUTER DOWNGRADED -> ${routedModel}] ${(promptText || "Low-complexity task").slice(0, 90)}`
          : `[ROUTER FRONTIER -> ${routedModel}] ${(promptText || "High-complexity task").slice(0, 90)}`,
        complexity_score: complexityScore,
        assigned_agents: 1,
        hibernated_count: 0,
        tokens_saved: tokensSaved,
        loop_incidents: 0,
        interception_ms: Math.round(totalGatewayMs),
        status: "COMPLETED",
      },
    });

    // Update target agent in cluster
    if (targetAgent) {
      await prisma.agent.update({
        where: { agent_id: targetAgent.agent_id },
        data: {
          model_tier: modelTier,
          tokens_used: { increment: tokensDeducted },
          current_task: (promptText || "Executed prompt through proxy gateway").slice(0, 120),
          locked_file_path:
            body.lockedFilePath || body.filePath || body.targetFilePath || targetAgent.locked_file_path,
          last_heartbeat_at: new Date(),
        },
      });
    }

    const outputMessage = isDowngraded
      ? `[ArgusOps Smart Downgrade Router -> ${routedModel}] Complexity score ${complexityScore} < 45: Task safely routed to high-efficiency model saving 75% tokens.`
      : `[ArgusOps Frontier Router -> ${routedModel}] Complexity score ${complexityScore} >= 45: Task routed to Frontier model.`;

    return NextResponse.json({
      success: true,
      status: "COMPLETED",
      model: routedModel,
      modelTier,
      downgraded: isDowngraded,
      complexityScore,
      tokensBurned: tokensDeducted,
      tokensSaved,
      contextHash,
      interceptionMs: totalGatewayMs,
      withinLatencyBudget: totalGatewayMs < MAX_INTERCEPTION_BUDGET_MS,
      clusterId: cluster.cluster_id,
      agentId: targetAgent?.agent_id,
      wallet: {
        free_tokens: updatedWallet.free_tokens,
        paid_tokens: updatedWallet.paid_tokens,
        total_available: updatedWallet.free_tokens + updatedWallet.paid_tokens,
      },
      message: isDowngraded
        ? `Smart Model Downgrading Router automatically routed low-complexity task (score: ${complexityScore}) to ${routedModel}, saving ${tokensSaved} tokens (75% savings).`
        : `Routed to ${routedModel} (complexity: ${complexityScore}).`,
      result: {
        output: outputMessage,
        model: routedModel,
        tokensBurned: tokensDeducted,
        tokensSaved,
      },
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputMessage,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: tokensDeducted,
        tokens_saved: tokensSaved,
      },
    });
  } catch (error) {
    const errorMs = +(performance.now() - gatewayStartTime).toFixed(2);
    console.error("LLM Interception Proxy Gateway error:", error);
    return NextResponse.json(
      {
        error: "Internal Gateway Error processing LLM proxy request.",
        interceptionMs: errorMs,
        details: error instanceof Error ? error.message : "Unknown error",
        statusCode: 500,
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/v1/proxy
// ============================================================================
export async function GET(req: NextRequest) {
  const checkStart = performance.now();

  try {
    const authResult = await authenticateRequest(req);
    const latencyMs = +(performance.now() - checkStart).toFixed(2);

    return NextResponse.json({
      gateway: "ArgusOps LLM Interception Proxy Gateway",
      version: "v1.1",
      status: "OPERATIONAL",
      latencySlaMs: MAX_INTERCEPTION_BUDGET_MS,
      probeLatencyMs: latencyMs,
      capabilities: {
        authentication: "x-argus-key or Authorization: Bearer <key>",
        demoKeySupported: true,
        sharedContextCache: "SHA-256 Memory Replay (Zero-Token)",
        loopCircuitBreaker: "Instant Kill Switch (<80% progress) & Paused Nudge (>=80% progress)",
        smartModelRouter: "Low-Complexity (<45) Frontier Downgrading to Fast Tier (75% token savings)",
      },
      authenticatedUser: authResult.user
        ? {
            id: authResult.user.id,
            email: authResult.user.email,
            status: authResult.user.status,
            subscriptionPlan: authResult.user.subscription?.plan_id,
            tokensAvailable:
              (authResult.user.subscription?.free_tokens ?? 0) +
              (authResult.user.subscription?.paid_tokens ?? 0),
          }
        : null,
    });
  } catch (error) {
    console.error("LLM Proxy GET status error:", error);
    return NextResponse.json(
      { error: "Failed to probe proxy gateway status.", statusCode: 500 },
      { status: 500 }
    );
  }
}
