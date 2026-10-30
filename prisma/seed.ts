import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Clearing existing database records...");

  // Delete in foreign-key dependency order
  await prisma.agent.deleteMany();
  await prisma.taskAndLog.deleteMany();
  await prisma.transactionApprovalQueue.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.clusterAndWorkspace.deleteMany();
  await prisma.subscriptionAndWallet.deleteMany();
  await prisma.pricingPlan.deleteMany();
  await prisma.user.deleteMany();

  console.log("💳 Seeding Pricing Plans...");
  const freePlan = await prisma.pricingPlan.create({
    data: {
      plan_id: "plan_free",
      name: "Free Tier",
      price: 0.0,
      agent_limit: 3,
      included_tokens: 50000,
      is_public: true,
      requires_admin_approval: false,
      description:
        "Essential starter plan for individual developers and local agent coordination. Includes 3 concurrent agents and 50,000 free tokens.",
    },
  });

  const proPlan = await prisma.pricingPlan.create({
    data: {
      plan_id: "plan_pro",
      name: "Pro Tier",
      price: 49.0,
      agent_limit: 25,
      included_tokens: 1500000,
      is_public: true,
      requires_admin_approval: true,
      description:
        "Designed for power developers and small teams running distributed agent swarms with advanced loop circuit-breakers and shared memory cache.",
    },
  });

  const enterprisePlan = await prisma.pricingPlan.create({
    data: {
      plan_id: "plan_enterprise",
      name: "Enterprise",
      price: 299.0,
      agent_limit: 100,
      included_tokens: 15000000,
      is_public: true,
      requires_admin_approval: true,
      description:
        "Full-scale agentic hypervisor and cost governance cluster for enterprise cloud swarms with dedicated SLA, 24/7 loop prevention, and unlimited workspaces.",
    },
  });

  console.log("👥 Seeding Users & Subscriptions...");
  // User a: Tamjid (Enterprise Plan)
  const tamjidUser = await prisma.user.create({
    data: {
      id: "usr_tamjid_master",
      email: "tamjid@argusops.dev",
      name: "Tamjidul Islam",
      password_hash: "$2a$12$eX4mP1eHaShVaLuE.tamjidArgusOpsDemo2026PasswordHash",
      role: "USER",
      status: "ACTIVE",
      two_factor_enabled: true,
      created_at: new Date(Date.now() - 86400000 * 30),
      subscription: {
        create: {
          id: "sub_tamjid_ent",
          plan_id: enterprisePlan.plan_id,
          free_tokens: 50000,
          paid_tokens: 12450000,
          max_agents: 100,
          purchase_status: "APPROVED",
        },
      },
      api_keys: {
        create: {
          id: "key_tamjid_prod",
          label: "Production Cloud Cluster Key",
          key_prefix: "ag_live_",
          key_hash: "hash_live_tamjid_argus_key_2026_prod",
          last_used_at: new Date(),
        },
      },
    },
  });

  // User b: Alex Rivera (Free Tier + PENDING upgrade)
  const devUser = await prisma.user.create({
    data: {
      id: "usr_dev_indie",
      email: "dev@localbridge.io",
      name: "Alex Rivera",
      password_hash: "$2a$12$eX4mP1eHaShVaLuE.devLocalBridge2026PasswordHash",
      role: "USER",
      status: "ACTIVE",
      two_factor_enabled: false,
      created_at: new Date(Date.now() - 86400000 * 5),
      subscription: {
        create: {
          id: "sub_dev_free",
          plan_id: freePlan.plan_id,
          free_tokens: 38200,
          paid_tokens: 0,
          max_agents: 3,
          purchase_status: "PENDING",
        },
      },
      api_keys: {
        create: {
          id: "key_dev_local",
          label: "Local PC Daemon Key",
          key_prefix: "ag_test_",
          key_hash: "hash_test_dev_bridge_key_2026_local",
          last_used_at: new Date(Date.now() - 1000 * 60 * 15),
        },
      },
    },
  });

  // User c: Admin User
  const adminUser = await prisma.user.create({
    data: {
      id: "usr_admin_platform",
      email: "admin@argusops.dev",
      name: "ArgusOps Admin",
      password_hash: "$2a$12$eX4mP1eHaShVaLuE.adminArgusOps2026PasswordHash",
      role: "ADMIN",
      status: "ACTIVE",
      two_factor_enabled: true,
      created_at: new Date(Date.now() - 86400000 * 60),
      subscription: {
        create: {
          id: "sub_admin_ent",
          plan_id: enterprisePlan.plan_id,
          free_tokens: 50000,
          paid_tokens: 50000000,
          max_agents: 100,
          purchase_status: "APPROVED",
        },
      },
    },
  });

  // User d: CTO FinOps Corp (stitch-07 demo)
  const ctoUser = await prisma.user.create({
    data: {
      id: "usr_cto_finops",
      email: "cto@finops-corp.io",
      name: "Marcus Sterling",
      password_hash: "$2a$12$eX4mP1eHaShVaLuE.ctoFinops2026PasswordHash",
      role: "USER",
      status: "ACTIVE",
      two_factor_enabled: true,
      created_at: new Date(Date.now() - 86400000 * 12),
      subscription: {
        create: {
          id: "sub_cto_finops",
          plan_id: freePlan.plan_id,
          free_tokens: 15400,
          paid_tokens: 0,
          max_agents: 3,
          purchase_status: "PENDING",
        },
      },
    },
  });

  // User e: Dev Indie Studio (stitch-07 demo)
  const indieDevUser = await prisma.user.create({
    data: {
      id: "usr_dev_indie_studio",
      email: "dev@indie-studio.dev",
      name: "Elena Rostova",
      password_hash: "$2a$12$eX4mP1eHaShVaLuE.indieStudio2026PasswordHash",
      role: "USER",
      status: "ACTIVE",
      two_factor_enabled: false,
      created_at: new Date(Date.now() - 86400000 * 7),
      subscription: {
        create: {
          id: "sub_dev_indie_studio",
          plan_id: freePlan.plan_id,
          free_tokens: 84520,
          paid_tokens: 0,
          max_agents: 3,
          purchase_status: "PENDING",
        },
      },
    },
  });

  // User f: Alex Autonomous Lab (stitch-07 demo)
  const alexUser = await prisma.user.create({
    data: {
      id: "usr_alex_autonomous",
      email: "alex@autonomous-lab.org",
      name: "Alex Zhao",
      password_hash: "$2a$12$eX4mP1eHaShVaLuE.alexAuto2026PasswordHash",
      role: "USER",
      status: "ACTIVE",
      two_factor_enabled: true,
      created_at: new Date(Date.now() - 86400000 * 18),
      subscription: {
        create: {
          id: "sub_alex_autonomous",
          plan_id: proPlan.plan_id,
          free_tokens: 50000,
          paid_tokens: 1840000,
          max_agents: 25,
          purchase_status: "APPROVED",
        },
      },
    },
  });

  console.log("☁️ Seeding Cloud Cluster for tamjid@argusops.dev (100 Agents)...");
  const cloudCluster = await prisma.clusterAndWorkspace.create({
    data: {
      cluster_id: "cluster_cloud_useast",
      user_id: tamjidUser.id,
      name: "Enterprise Cloud Swarm us-east",
      environment: "CLOUD",
      active_agents: 28,
      hibernated_agents: 70,
      cached_context_hash: "sha256:8f4b23a91e5d7c81f34a0293ebc451",
      cache_tokens_saved: 4820000,
      zero_trust_local: false,
      created_at: new Date(Date.now() - 86400000 * 14),
    },
  });

  // Build the 100 agents:
  // - 28 ACTIVE
  // - 1 PAUSED_NUDGE (92% complete waiting on human confirmation)
  // - 1 KILLED_LOOP (circuit breaker tripped at 38ms due to repeated tool error)
  // - 70 HIBERNATED (Zero-Token state, 0 RAM, 0 CPU)
  const agentBatchData = [];

  // 1 to 28: ACTIVE agents
  const activeTasks = [
    "Synthesizing vector embeddings for code index",
    "Running distributed unit tests on billing pipeline",
    "Translating legacy SQL queries to Prisma schema",
    "Validating AST token consumption across worker nodes",
    "Parsing OpenAPI specification models",
    "Auditing dependency vulnerability graph",
    "Transpiling worker threads to WebAssembly target",
    "Indexing codebase symbols and references",
  ];

  for (let i = 1; i <= 28; i++) {
    const numStr = i.toString().padStart(2, "0");
    const ram = +(120 + Math.sin(i) * 35).toFixed(1);
    const cpu = +(15 + Math.cos(i) * 12).toFixed(1);
    const tokens = 35000 + i * 4200;
    agentBatchData.push({
      agent_id: `agent_cloud_active_${numStr}`,
      cluster_id: cloudCluster.cluster_id,
      name: `Cloud-Worker-${numStr}`,
      agent_type: "CLOUD_WORKER",
      status: "ACTIVE",
      model_tier: i % 3 === 0 ? "DOWNGRADED_FAST" : "FRONTIER",
      ram_usage: ram,
      cpu_usage: cpu,
      tokens_used: tokens,
      current_task: activeTasks[(i - 1) % activeTasks.length],
      locked_file_path: i % 4 === 0 ? `src/workers/worker-${numStr}.ts` : null,
      loop_score: +(0.02 + (i % 5) * 0.01).toFixed(2),
      last_heartbeat_at: new Date(Date.now() - 1000 * (i * 2)),
    });
  }

  // 29: PAUSED_NUDGE agent
  agentBatchData.push({
    agent_id: "agent_cloud_nudge_29",
    cluster_id: cloudCluster.cluster_id,
    name: "Cloud-Worker-29-Auditor",
    agent_type: "CLOUD_WORKER",
    status: "PAUSED_NUDGE",
    model_tier: "FRONTIER",
    ram_usage: 198.4,
    cpu_usage: 1.8,
    tokens_used: 245000,
    current_task:
      "Refactoring database migration scripts (92% complete, awaiting human confirmation)",
    locked_file_path: "prisma/migrations/20261030_enterprise_v11.sql",
    loop_score: 0.68,
    last_heartbeat_at: new Date(Date.now() - 1000 * 45),
  });

  // 30: KILLED_LOOP agent
  agentBatchData.push({
    agent_id: "agent_cloud_killed_30",
    cluster_id: cloudCluster.cluster_id,
    name: "Cloud-Worker-30-Crawler",
    agent_type: "CLOUD_WORKER",
    status: "KILLED_LOOP",
    model_tier: "DOWNGRADED_FAST",
    ram_usage: 0.0,
    cpu_usage: 0.0,
    tokens_used: 412000,
    current_task:
      "Scraping API endpoints (circuit breaker tripped at 38ms due to repeated tool error)",
    locked_file_path: null,
    loop_score: 0.99,
    last_heartbeat_at: new Date(Date.now() - 1000 * 60 * 12),
  });

  // 31 to 100: 70 HIBERNATED agents (Zero-Token state, 0 RAM, 0 CPU)
  for (let i = 31; i <= 100; i++) {
    const numStr = i.toString().padStart(3, "0");
    agentBatchData.push({
      agent_id: `agent_cloud_hibernated_${numStr}`,
      cluster_id: cloudCluster.cluster_id,
      name: `Standby-Worker-${numStr}`,
      agent_type: "CLOUD_WORKER",
      status: "HIBERNATED",
      model_tier: "FRONTIER",
      ram_usage: 0.0,
      cpu_usage: 0.0,
      tokens_used: 0,
      current_task: "Hibernated in zero-token standby pool by Master Hypervisor",
      locked_file_path: null,
      loop_score: 0.0,
      last_heartbeat_at: new Date(Date.now() - 1000 * 60 * 60 * 4),
    });
  }

  // Create all 100 agents for Cloud Cluster
  for (const agent of agentBatchData) {
    await prisma.agent.create({ data: agent });
  }

  console.log("💻 Seeding Local PC Cluster for tamjid@argusops.dev (3 Agents)...");
  const localCluster = await prisma.clusterAndWorkspace.create({
    data: {
      cluster_id: "cluster_local_win11",
      user_id: tamjidUser.id,
      name: "Desktop Bridge - Windows 11",
      environment: "LOCAL_PC",
      active_agents: 3,
      hibernated_agents: 0,
      cached_context_hash: "sha256:local_win11_context_mutex_9918",
      cache_tokens_saved: 320000,
      zero_trust_local: true,
      created_at: new Date(Date.now() - 86400000 * 2),
    },
  });

  // 3 Local PC Agents
  await prisma.agent.create({
    data: {
      agent_id: "agent_local_antigravity",
      cluster_id: localCluster.cluster_id,
      name: "Antigravity Agent",
      agent_type: "ANTIGRAVITY",
      status: "ACTIVE",
      model_tier: "FRONTIER",
      ram_usage: 84.5,
      cpu_usage: 18.2,
      tokens_used: 128500,
      current_task: "Implementing strict dashboard shell geometry and stats visualizer",
      locked_file_path: "src/app/dashboard/page.tsx",
      loop_score: 0.02,
      last_heartbeat_at: new Date(),
    },
  });

  await prisma.agent.create({
    data: {
      agent_id: "agent_local_claude",
      cluster_id: localCluster.cluster_id,
      name: "Claude Agent",
      agent_type: "CLAUDE",
      status: "ACTIVE",
      model_tier: "FRONTIER",
      ram_usage: 92.1,
      cpu_usage: 14.7,
      tokens_used: 94200,
      current_task: "Optimizing low-latency AST interception and semantic loop detector",
      locked_file_path: "src/lib/loop-detector.ts",
      loop_score: 0.04,
      last_heartbeat_at: new Date(),
    },
  });

  await prisma.agent.create({
    data: {
      agent_id: "agent_local_hermes",
      cluster_id: localCluster.cluster_id,
      name: "Hermes Agent",
      agent_type: "HERMES",
      status: "ACTIVE",
      model_tier: "DOWNGRADED_FAST",
      ram_usage: 45.3,
      cpu_usage: 8.4,
      tokens_used: 41200,
      current_task:
        "Writing integration test suite for subscription upgrades and billing approval queue",
      locked_file_path: "src/tests/billing.spec.ts",
      loop_score: 0.01,
      last_heartbeat_at: new Date(),
    },
  });

  console.log("📝 Seeding Tasks and Logs...");
  await prisma.taskAndLog.createMany({
    data: [
      {
        task_id: "tsk_cloud_01",
        cluster_id: cloudCluster.cluster_id,
        prompt_summary:
          "Analyze 10,000 repository commits, synthesize changelog, and deploy microservice cluster",
        complexity_score: 88,
        assigned_agents: 28,
        hibernated_count: 70,
        tokens_saved: 3250000,
        loop_incidents: 1,
        interception_ms: 38,
        status: "RUNNING",
        created_at: new Date(Date.now() - 3600000 * 2),
      },
      {
        task_id: "tsk_cloud_02",
        cluster_id: cloudCluster.cluster_id,
        prompt_summary:
          "Execute distributed fuzz testing across OAuth2 authentication microservices",
        complexity_score: 65,
        assigned_agents: 15,
        hibernated_count: 85,
        tokens_saved: 1480000,
        loop_incidents: 0,
        interception_ms: 24,
        status: "COMPLETED",
        created_at: new Date(Date.now() - 86400000),
      },
      {
        task_id: "tsk_local_01",
        cluster_id: localCluster.cluster_id,
        prompt_summary:
          "Synchronize multi-agent local code edits across Claude, Antigravity, and Hermes with file lock mutex",
        complexity_score: 42,
        assigned_agents: 3,
        hibernated_count: 0,
        tokens_saved: 320000,
        loop_incidents: 0,
        interception_ms: 18,
        status: "RUNNING",
        created_at: new Date(Date.now() - 3600000),
      },
    ],
  });

  console.log("📋 Seeding Transaction Approval Queue...");
  await prisma.transactionApprovalQueue.createMany({
    data: [
      {
        tx_id: "tx_0192a",
        user_id: ctoUser.id,
        requested_plan: "Enterprise (100 Agents)",
        amount: 490.0,
        admin_status: "PENDING",
        created_at: new Date(Date.now() - 3600000 * 2),
        reviewed_at: null,
      },
      {
        tx_id: "tx_0193b",
        user_id: indieDevUser.id,
        requested_plan: "Pro Swarm (25 Agents)",
        amount: 49.0,
        admin_status: "PENDING",
        created_at: new Date(Date.now() - 3600000 * 4),
        reviewed_at: null,
      },
      {
        tx_id: "tx_pending_dev_pro",
        user_id: devUser.id,
        requested_plan: "Pro Tier",
        amount: 49.0,
        admin_status: "PENDING",
        created_at: new Date(Date.now() - 3600000 * 6),
        reviewed_at: null,
      },
      {
        tx_id: "tx_approved_tamjid_ent",
        user_id: tamjidUser.id,
        requested_plan: "Enterprise",
        amount: 299.0,
        admin_status: "APPROVED",
        created_at: new Date(Date.now() - 86400000 * 2),
        reviewed_at: new Date(Date.now() - 86400000),
      },
    ],
  });

  console.log("✅ Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

