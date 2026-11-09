import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { checkAgentSlot, ownedAgent, recordIncident, releaseLocksFor } from "@/lib/control-plane";

/**
 * Cluster-level agent state changes. The only supported action is TOGGLE_AGENT_STATUS
 * (hibernate / wake an agent); every agent is looked up through its owner, and waking one needs a
 * free slot on the plan. Kill and resume live in /api/guardrails; the old simulate/right-size
 * actions that invented numbers were removed.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.via !== "session") {
    return NextResponse.json({ error: "Sign in to change agent state." }, { status: 403 });
  }
  const userId = auth.user.id;

  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    if (action !== "TOGGLE_AGENT_STATUS") {
      return NextResponse.json(
        { success: false, error: `Unknown or removed action: ${String(action)}.` },
        { status: 400 }
      );
    }

    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    const target = body.targetStatus;
    if (!agentId) return NextResponse.json({ success: false, error: "agentId is required." }, { status: 400 });
    if (target !== "ACTIVE" && target !== "HIBERNATED") {
      return NextResponse.json({ success: false, error: "targetStatus must be ACTIVE or HIBERNATED." }, { status: 400 });
    }

    const agent = await ownedAgent(userId, agentId);
    if (!agent) return NextResponse.json({ success: false, error: "Agent not found." }, { status: 404 });

    if (agent.status === "KILLED_LOOP") {
      return NextResponse.json(
        { success: false, error: "A stopped agent must be restarted from its CLI, not toggled here." },
        { status: 409 }
      );
    }
    if (agent.status === target) {
      return NextResponse.json({ success: true, message: `${agent.name} is already ${target.toLowerCase()}.`, agent });
    }

    if (target === "ACTIVE") {
      const slot = await checkAgentSlot(userId);
      if (!slot.ok) return NextResponse.json({ success: false, error: slot.message }, { status: 403 });
    }

    const updated = await prisma.agent.update({
      where: { agent_id: agent.agent_id },
      data:
        target === "HIBERNATED"
          ? { status: "HIBERNATED", ram_usage: 0, cpu_usage: 0, locked_file_path: null }
          : { status: "ACTIVE", last_heartbeat_at: new Date() },
    });
    if (target === "HIBERNATED") await releaseLocksFor(userId, { holder: agent.name });

    await recordIncident({
      userId,
      agentId: agent.agent_id,
      agentName: agent.name,
      kind: "WASTE",
      severity: "INFO",
      action: "NONE",
      detail: target === "HIBERNATED" ? `${agent.name} was hibernated by the operator.` : `${agent.name} was woken by the operator.`,
    });

    return NextResponse.json({
      success: true,
      message: target === "HIBERNATED" ? `${agent.name} hibernated.` : `${agent.name} is active again.`,
      agent: updated,
    });
  } catch (error) {
    console.error("Cluster action error:", error);
    return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
  }
}
