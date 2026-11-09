import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { sanitizePermissions } from "@/lib/control-plane-core";
import {
  applyHeartbeat,
  getPermissions,
  listLocks,
  releaseLockById,
  updatePermissions,
  type FileMutexLock,
} from "@/lib/control-plane";

export type { FileMutexLock };

/** A device counts as connected if it checked in within this window. */
const CONNECTED_WINDOW_MS = 2 * 60_000;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  try {
    const [cluster, fileLocks, permissions, devices] = await Promise.all([
      prisma.clusterAndWorkspace.findFirst({
        where: { user_id: userId, environment: "LOCAL_PC" },
        include: { agents: { orderBy: { name: "asc" } } },
      }),
      listLocks(userId),
      getPermissions(userId),
      prisma.cliDevice.findMany({
        where: { user_id: userId, status: "APPROVED" },
        select: { name: true, last_seen_at: true },
      }),
    ]);

    const now = Date.now();
    const connected = devices.filter((d) => d.last_seen_at && now - d.last_seen_at.getTime() < CONNECTED_WINDOW_MS);

    return NextResponse.json({
      success: true,
      cluster,
      daemon: {
        connectedDevices: connected.length,
        pairedDevices: devices.length,
        lastSeenAt: devices.reduce<Date | null>(
          (latest, d) => (d.last_seen_at && (!latest || d.last_seen_at > latest) ? d.last_seen_at : latest),
          null
        ),
      },
      fileLocks,
      permissions,
    });
  } catch (error) {
    console.error("Local Bridge GET error:", error);
    return NextResponse.json({ error: "Failed to retrieve local bridge data." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    switch (action) {
      case "HEARTBEAT": {
        // Daemons authenticate with an API key; the heartbeat only touches the key owner's cluster.
        const result = await applyHeartbeat(userId, auth.user.name, body.agents);
        if (auth.via === "api_key" && auth.apiKeyId) {
          await prisma.cliDevice
            .updateMany({ where: { user_id: userId, api_key_id: auth.apiKeyId }, data: { last_seen_at: new Date() } })
            .catch(() => undefined);
        }
        return NextResponse.json({
          success: true,
          message: "Heartbeat received.",
          ...result,
          fileLocks: await listLocks(userId),
        });
      }

      case "RELEASE_LOCK": {
        if (auth.via !== "session") return NextResponse.json({ error: "Sign in to release locks." }, { status: 403 });
        const lockId = typeof body.lockId === "string" ? body.lockId : "";
        if (!lockId) return NextResponse.json({ error: "lockId is required." }, { status: 400 });
        const lock = await releaseLockById(userId, lockId);
        if (!lock) return NextResponse.json({ error: "Lock not found." }, { status: 404 });
        return NextResponse.json({
          success: true,
          message: `Lock on '${lock.file_path}' released.`,
          fileLocks: await listLocks(userId),
        });
      }

      case "UPDATE_PERMISSIONS": {
        if (auth.via !== "session") return NextResponse.json({ error: "Sign in to change permissions." }, { status: 403 });
        const permissions = await updatePermissions(userId, sanitizePermissions(body.permissions));
        return NextResponse.json({
          success: true,
          message: "Local governance permissions saved.",
          permissions,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown or removed action: ${String(action)}. Simulation actions are no longer available.` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Local Bridge POST error:", error);
    return NextResponse.json({ error: "Internal server error while processing the local bridge action." }, { status: 500 });
  }
}
