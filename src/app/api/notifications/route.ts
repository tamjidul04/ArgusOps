import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/** The signed-in user's notifications (newest first) and how many are unread. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.round(limitParam))) : 20;

  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { user_id: auth.user.id },
      orderBy: { created_at: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { user_id: auth.user.id, read_at: null } }),
  ]);

  return NextResponse.json({
    unread,
    notifications: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      level: n.level,
      read: n.read_at !== null,
      agentId: n.agent_id,
      createdAt: n.created_at.toISOString(),
    })),
  });
}

/** Mark some (or all) of the user's notifications as read. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  if (body.action !== "mark_read") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 200) : [];
  if (!body.all && ids.length === 0) return NextResponse.json({ error: "Pass ids or all: true." }, { status: 400 });

  const result = await prisma.notification.updateMany({
    where: { user_id: auth.user.id, read_at: null, ...(body.all ? {} : { id: { in: ids } }) },
    data: { read_at: new Date() },
  });
  const unread = await prisma.notification.count({ where: { user_id: auth.user.id, read_at: null } });
  return NextResponse.json({ success: true, marked: result.count, unread });
}
