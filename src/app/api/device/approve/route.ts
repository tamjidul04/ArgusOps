import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { normalizeUserCode } from "@/lib/device-flow";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Step 2 of `argus login`: a signed-in user approves (or denies) the code shown in their terminal. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  // Only an interactive browser session may approve: an API key must not be able to mint more keys.
  if (auth.via !== "session") {
    return NextResponse.json({ error: "Sign in to approve a device." }, { status: 403 });
  }

  // Codes are short, so cap guessing per user and per address.
  const byUser = rateLimit(`device-approve:${auth.user.id}`, 10, 10 * 60_000);
  const byIp = rateLimit(`device-approve-ip:${clientIp(req)}`, 30, 10 * 60_000);
  if (!byUser.allowed || !byIp.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const code = typeof body.user_code === "string" ? normalizeUserCode(body.user_code) : null;
  if (!code) return NextResponse.json({ error: "That code isn't valid. Check it and try again." }, { status: 400 });
  const approve = body.approve !== false;

  const device = await prisma.cliDevice.findUnique({ where: { user_code: code } });
  if (!device || device.expires_at.getTime() <= Date.now() || device.status !== "PENDING") {
    return NextResponse.json({ error: "That code has expired or was already used." }, { status: 404 });
  }

  const updated = await prisma.cliDevice.updateMany({
    where: { id: device.id, status: "PENDING" },
    data: approve ? { status: "APPROVED", user_id: auth.user.id } : { status: "DENIED", user_id: auth.user.id },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ error: "That code has expired or was already used." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    approved: approve,
    device: device.name,
    message: approve ? `${device.name ?? "The device"} is connected. You can return to your terminal.` : "Request denied.",
  });
}
