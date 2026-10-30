import { NextRequest } from "next/server";
import { POST, GET } from "./src/app/api/v1/proxy/route";
import { prisma } from "./src/lib/prisma";

async function runTests() {
  console.log("🚀 Starting ArgusOps LLM Proxy Gateway Validation Test Suite...\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      if (details) console.error("     Details:", details);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: GET Probe / Health Check
  // --------------------------------------------------------------------------
  console.log("👉 Test Suite 1: Health Probe & Authentication & Wallet Check");
  {
    const req = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "GET",
      headers: { "x-argus-key": "argus_live_demo_key" },
    });
    const res = await GET(req);
    const data = await res.json();
    assert(res.status === 200, "GET /api/v1/proxy returns 200 OK");
    assert(data.status === "OPERATIONAL", "Gateway status is OPERATIONAL");
    assert(data.capabilities?.demoKeySupported === true, "Demo key supported in capabilities");
    assert(data.authenticatedUser?.id === "usr_tamjid_master", "Demo key authenticates usr_tamjid_master");
  }

  // --------------------------------------------------------------------------
  // TEST 2: Missing API Key -> 401
  // --------------------------------------------------------------------------
  {
    const req = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello world" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert(res.status === 401, "Missing API key returns 401 Unauthorized");
    assert(data.error.includes("Missing API key"), "Error message specifies missing key");
  }

  // --------------------------------------------------------------------------
  // TEST 3: Invalid API Key -> 401
  // --------------------------------------------------------------------------
  {
    const req = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "invalid_bogus_key_999",
      },
      body: JSON.stringify({ prompt: "Hello world" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert(res.status === 401, "Invalid API key returns 401 Unauthorized");
  }

  // --------------------------------------------------------------------------
  // TEST 4: Demo Key in Api_Keys Table & Bearer Authorization header
  // --------------------------------------------------------------------------
  {
    const req = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer argus_live_demo_key",
      },
      body: JSON.stringify({
        prompt: "Simple test prompt",
        clusterId: "cluster_cloud_useast",
      }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert(res.status === 200, "Authorization: Bearer argus_live_demo_key returns 200 OK");
    assert(data.success === true, "Request succeeds with Bearer token");

    // Verify key exists in Api_Keys table
    const dbKey = await prisma.apiKey.findFirst({
      where: {
        OR: [
          { id: "key_argus_live_demo" },
          { key_prefix: "argus_live_demo_key" },
        ],
      },
    });
    assert(!!dbKey, "argus_live_demo_key persisted in Api_Keys table");
  }

  // --------------------------------------------------------------------------
  // TEST 5: Depleted Wallet -> 402 Payment Required
  // --------------------------------------------------------------------------
  {
    // Temporarily create a user with 0 free and 0 paid tokens
    const testUser = await prisma.user.create({
      data: {
        id: "usr_zero_token_test",
        email: "zero@test.io",
        name: "Zero Token Tester",
        password_hash: "hash",
        status: "ACTIVE",
        subscription: {
          create: {
            id: "sub_zero_token",
            plan_id: "plan_free",
            free_tokens: 0,
            paid_tokens: 0,
            max_agents: 3,
            purchase_status: "APPROVED",
          },
        },
        api_keys: {
          create: {
            id: "key_zero_token",
            label: "Zero Token Key",
            key_prefix: "ag_zero_",
            key_hash: "hash_zero_token_test",
          },
        },
      },
    });

    const req = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "hash_zero_token_test",
      },
      body: JSON.stringify({ prompt: "Test with zero tokens" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert(res.status === 402, "Zero token wallet returns 402 Payment Required");
    assert(data.error.includes("Token balance depleted"), "402 response indicates token depletion");

    // Clean up temporary test user
    await prisma.apiKey.deleteMany({ where: { user_id: testUser.id } });
    await prisma.subscriptionAndWallet.deleteMany({ where: { user_id: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Shared Context & Memory Cache (PRD Section 5.1)
  // --------------------------------------------------------------------------
  console.log("\n👉 Test Suite 2: Shared Context & Memory Cache (PRD Section 5.1)");
  {
    const cluster = await prisma.clusterAndWorkspace.findUnique({
      where: { cluster_id: "cluster_cloud_useast" },
    });
    const initialSavedTokens = cluster?.cache_tokens_saved || 0;

    const runId = Date.now();
    const testPayload = {
      prompt: `Refactor enterprise auth service and synchronize OAuth session mutex [run_${runId}]`,
      toolCall: { name: "scan_ast_tokens", args: { path: "src/auth.ts", run: runId } },
      workspaceFiles: ["src/auth.ts", "prisma/schema.prisma"],
      clusterId: "cluster_cloud_useast",
      model: "claude-3-7-sonnet",
    };

    // First request: Cache Miss
    const req1 = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "argus_live_demo_key",
      },
      body: JSON.stringify(testPayload),
    });
    const res1 = await POST(req1);
    const data1 = await res1.json();
    assert(res1.status === 200, "First context call succeeds");
    assert(data1.cached !== true, "First context call is a cache miss");
    assert(typeof data1.contextHash === "string" && data1.contextHash.startsWith("sha256:"), "Context hash generated");

    // Second request: Cache Hit
    const req2 = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "argus_live_demo_key",
      },
      body: JSON.stringify(testPayload),
    });
    const res2 = await POST(req2);
    const data2 = await res2.json();
    assert(res2.status === 200, "Second context call returns 200 OK");
    assert(data2.cached === true, "Second context call is a CACHE HIT");
    assert(data2.tokensBurned === 0, "Cache hit returns tokensBurned: 0");
    assert(data2.tokensSaved >= 60000, "Cache hit records >= 60,000 saved tokens");

    // Verify cache_tokens_saved in Clusters_And_Workspaces incremented
    const updatedCluster = await prisma.clusterAndWorkspace.findUnique({
      where: { cluster_id: "cluster_cloud_useast" },
    });
    assert(
      (updatedCluster?.cache_tokens_saved || 0) > initialSavedTokens,
      "cache_tokens_saved incremented in Clusters_And_Workspaces"
    );

    // Verify TaskAndLog record created
    const cacheLog = await prisma.taskAndLog.findFirst({
      where: {
        cluster_id: "cluster_cloud_useast",
        prompt_summary: { contains: "CACHE HIT" },
      },
      orderBy: { created_at: "desc" },
    });
    assert(!!cacheLog && cacheLog.tokens_saved >= 60000, "Tasks_And_Logs logs the saved cache tokens");
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 3: Real-Time <100ms Infinite Loop Circuit Breaker (PRD 4.2)
  // --------------------------------------------------------------------------
  console.log("\n👉 Test Suite 3: Real-Time <100ms Infinite Loop Circuit Breaker (PRD Section 4.2)");
  {
    // Part A: Rogue loop with progress < 80% -> Instant Kill Switch (429)
    const testAgent = await prisma.agent.create({
      data: {
        agent_id: "agent_test_loop_breaker",
        cluster_id: "cluster_cloud_useast",
        name: "Test Loop Crawler",
        agent_type: "CLOUD_WORKER",
        status: "ACTIVE",
        ram_usage: 145.2,
        cpu_usage: 45.0,
        tokens_used: 12000,
      },
    });

    const loopReqLowProgress = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "argus_live_demo_key",
      },
      body: JSON.stringify({
        agentId: testAgent.agent_id,
        clusterId: "cluster_cloud_useast",
        taskProgressPct: 35, // < 80%
        recentLogs: [
          "Executing tool: fetch_remote_resource(endpoint='/data/stream')",
          "Executing tool: fetch_remote_resource(endpoint='/data/stream')",
        ],
      }),
    });

    const resKill = await POST(loopReqLowProgress);
    const dataKill = await resKill.json();
    assert(resKill.status === 429, "Low progress loop returns HTTP 429 Too Many Requests");
    assert(dataKill.status === "KILLED_LOOP", "Response status is KILLED_LOOP");
    assert(dataKill.message.includes("ArgusOps Circuit Breaker halted infinite loop"), "Circuit breaker message matches PRD");
    assert(typeof dataKill.interceptionMs === "number" && dataKill.interceptionMs < 100, `Interception latency < 100ms (${dataKill.interceptionMs}ms)`);

    // Verify agent in Prisma: status = KILLED_LOOP, ram_usage = 0, cpu_usage = 0
    const killedAgentInDb = await prisma.agent.findUnique({
      where: { agent_id: testAgent.agent_id },
    });
    assert(killedAgentInDb?.status === "KILLED_LOOP", "Agent status updated to KILLED_LOOP in DB");
    assert(killedAgentInDb?.ram_usage === 0, "Agent RAM reset to 0 in DB");
    assert(killedAgentInDb?.cpu_usage === 0, "Agent CPU reset to 0 in DB");

    // Verify loop_incidents logged in Tasks_And_Logs
    const killLog = await prisma.taskAndLog.findFirst({
      where: {
        cluster_id: "cluster_cloud_useast",
        status: "KILLED_LOOP",
      },
      orderBy: { created_at: "desc" },
    });
    assert(!!killLog && killLog.loop_incidents === 1, "loop_incidents incremented in Tasks_And_Logs");

    // Part B: Loop with progress >= 80% -> Human-in-the-Loop Paused Nudge (423)
    // Reset test agent to ACTIVE
    await prisma.agent.update({
      where: { agent_id: testAgent.agent_id },
      data: { status: "ACTIVE", ram_usage: 160 },
    });

    const loopReqHighProgress = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "argus_live_demo_key",
      },
      body: JSON.stringify({
        agentId: testAgent.agent_id,
        clusterId: "cluster_cloud_useast",
        taskProgressPct: 92, // >= 80%
        recentLogs: [
          "Running migration step ALTER TABLE users ADD COLUMN oauth_token",
          "Running migration step ALTER TABLE users ADD COLUMN oauth_token",
        ],
      }),
    });

    const resNudge = await POST(loopReqHighProgress);
    const dataNudge = await resNudge.json();
    assert(resNudge.status === 423, "High progress loop (>=80%) returns HTTP 423 Locked");
    assert(dataNudge.status === "PAUSED_NUDGE", "Response status is PAUSED_NUDGE");
    assert(dataNudge.message === "Human-in-the-Loop Nudge required before continuing.", "Nudge message matches specification");

    // Verify agent in Prisma: status = PAUSED_NUDGE
    const pausedAgentInDb = await prisma.agent.findUnique({
      where: { agent_id: testAgent.agent_id },
    });
    assert(pausedAgentInDb?.status === "PAUSED_NUDGE", "Agent status updated to PAUSED_NUDGE in DB");

    // Clean up test agent
    await prisma.agent.delete({ where: { agent_id: testAgent.agent_id } });
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Smart Model Downgrading Router (PRD Section 5.1)
  // --------------------------------------------------------------------------
  console.log("\n👉 Test Suite 4: Smart Model Downgrading Router (PRD Section 5.1)");
  {
    const initialUser = await prisma.user.findFirst({
      where: { id: "usr_tamjid_master" },
      include: { subscription: true },
    });
    const startPaidTokens = initialUser?.subscription?.paid_tokens || 0;

    // Case A: Low complexity (< 45) + Frontier requested -> DOWNGRADED_FAST
    const lowComplexityReq = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "argus_live_demo_key",
      },
      body: JSON.stringify({
        prompt: "Print hello world in python", // Complexity = 10 (< 45)
        model: "claude-3-7-sonnet", // Expensive Frontier model requested
        clusterId: "cluster_cloud_useast",
        tokens: 1000,
      }),
    });

    const resLow = await POST(lowComplexityReq);
    const dataLow = await resLow.json();
    assert(resLow.status === 200, "Low-complexity router call returns 200 OK");
    assert(dataLow.downgraded === true, "Model was automatically downgraded");
    assert(dataLow.modelTier === "DOWNGRADED_FAST", "modelTier is DOWNGRADED_FAST");
    assert(
      dataLow.model === "claude-3-haiku" || dataLow.model === "gemini-2.5-flash",
      `Target model downgraded to high-efficiency tier: ${dataLow.model}`
    );
    assert(dataLow.tokensBurned === 250, "75% fewer tokens deducted (250 tokens deducted instead of 1000)");
    assert(dataLow.tokensSaved === 750, "750 tokens recorded as saved (75% savings)");

    // Verify wallet deduction
    const userAfterDowngrade = await prisma.user.findFirst({
      where: { id: "usr_tamjid_master" },
      include: { subscription: true },
    });
    const deductedTokens = startPaidTokens - (userAfterDowngrade?.subscription?.paid_tokens || 0);
    assert(deductedTokens === 250, `Wallet deducted exactly 250 tokens (actual: ${deductedTokens})`);

    // Verify Tasks_And_Logs recorded token savings
    const downgradeLog = await prisma.taskAndLog.findFirst({
      where: {
        cluster_id: "cluster_cloud_useast",
        prompt_summary: { contains: "ROUTER DOWNGRADED" },
      },
      orderBy: { created_at: "desc" },
    });
    assert(!!downgradeLog && downgradeLog.tokens_saved === 750, "Tasks_And_Logs recorded token savings");

    // Case B: High complexity (>= 45) + Frontier requested -> Kept as FRONTIER
    const highComplexityReq = new NextRequest("http://localhost:3000/api/v1/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-argus-key": "argus_live_demo_key",
      },
      body: JSON.stringify({
        prompt: "Design a distributed microservices gateway with JWT auth, OAuth2 sessions, PostgreSQL database migrations, Redis pubsub, and Kubernetes container deployment pipelines with fuzz testing",
        model: "claude-3-7-sonnet",
        clusterId: "cluster_cloud_useast",
        tokens: 1000,
      }),
    });

    const resHigh = await POST(highComplexityReq);
    const dataHigh = await resHigh.json();
    assert(resHigh.status === 200, "High-complexity router call returns 200 OK");
    assert(dataHigh.downgraded === false, "High complexity task is NOT downgraded");
    assert(dataHigh.modelTier === "FRONTIER", "modelTier remains FRONTIER");
    assert(dataHigh.model === "claude-3-7-sonnet", "Requested frontier model preserved");
    assert(dataHigh.tokensBurned === 1000, "Standard 1000 tokens deducted");
    assert(dataHigh.tokensSaved === 0, "No token savings on frontier run");
  }

  console.log(`\n==================================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution threw exception:", err);
  process.exit(1);
});
