import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { validateWebhookUrl } from "@/lib/notify-core";
import { allowPrivateWebhooks, sendTestToChannel } from "@/lib/notifier";

const MAX_CHANNELS = 10;

/** Webhook URLs carry secrets (Slack puts its token in the path), so only a masked form ever leaves the server. */
function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const tail = (u.pathname + u.search).slice(-4);
    return `${u.protocol}//${u.host}/…${tail}`;
  } catch {
    return "…";
  }
}

async function listChannels(userId: string) {
  const rows = await prisma.notificationChannel.findMany({ where: { user_id: userId }, orderBy: { created_at: "asc" } });
  return rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    target: maskUrl(c.target),
    enabled: c.enabled,
    lastDeliveredAt: c.last_delivered_at?.toISOString() ?? null,
    lastError: c.last_error,
    createdAt: c.created_at.toISOString(),
  }));
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    channels: await listChannels(auth.user.id),
    email: { available: false, reason: "Email alerts aren't set up on this server yet." },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  // Adding a destination for your alerts is a settings change: interactive sessions only.
  if (auth.via !== "session") return NextResponse.json({ error: "Sign in to change notification settings." }, { status: 403 });
  const userId = auth.user.id;
  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case "create": {
      const check = validateWebhookUrl(body.target, { allowPrivate: allowPrivateWebhooks() });
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
      const count = await prisma.notificationChannel.count({ where: { user_id: userId } });
      if (count >= MAX_CHANNELS) return NextResponse.json({ error: `You can add up to ${MAX_CHANNELS} webhooks.` }, { status: 400 });
      const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : check.url.hostname;
      await prisma.notificationChannel.create({ data: { user_id: userId, kind: "WEBHOOK", target: check.url.toString(), label } });
      return NextResponse.json({ success: true, message: "Webhook added. Send a test to check it works.", channels: await listChannels(userId) }, { status: 201 });
    }

    case "toggle": {
      const id = typeof body.id === "string" ? body.id : "";
      const result = await prisma.notificationChannel.updateMany({ where: { id, user_id: userId }, data: { enabled: body.enabled === true } });
      if (result.count === 0) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
      return NextResponse.json({ success: true, channels: await listChannels(userId) });
    }

    case "test": {
      const id = typeof body.id === "string" ? body.id : "";
      const result = await sendTestToChannel(userId, id);
      if (!result.ok && result.error === "Channel not found.") return NextResponse.json({ error: result.error }, { status: 404 });
      return NextResponse.json({
        success: result.ok,
        message: result.ok ? "Test message delivered." : `Delivery failed: ${result.error}`,
        channels: await listChannels(userId),
      });
    }

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.via !== "session") return NextResponse.json({ error: "Sign in to change notification settings." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const result = await prisma.notificationChannel.deleteMany({ where: { id, user_id: auth.user.id } });
  if (result.count === 0) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  return NextResponse.json({ success: true, channels: await listChannels(auth.user.id) });
}
