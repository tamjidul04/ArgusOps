import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/auth-core";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { pollOutcome } from "@/lib/device-flow";

/**
 * Step 3 of `argus login`: the CLI polls with its secret device_code. Once the user has approved it in the
 * browser, the first poll mints an API key and returns it exactly once (only its hash is stored).
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(`device-token:${clientIp(req)}`, 120, 10 * 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "slow_down" }, { status: 429, headers: { "Retry-After": "5" } });
  }

  const body = await req.json().catch(() => ({}));
  const deviceCode = typeof body.device_code === "string" ? body.device_code : "";
  if (!deviceCode) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const device = await prisma.cliDevice.findUnique({ where: { device_code: deviceCode } });
  if (!device) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });

  const outcome = pollOutcome(device);
  const polledAt = new Date();

  if (outcome.kind === "pending" || outcome.kind === "slow_down") {
    await prisma.cliDevice.update({ where: { id: device.id }, data: { last_polled_at: polledAt } });
    return NextResponse.json(
      { error: outcome.kind === "slow_down" ? "slow_down" : "authorization_pending" },
      { status: 400 }
    );
  }
  if (outcome.kind === "expired") return NextResponse.json({ error: "expired_token" }, { status: 400 });
  if (outcome.kind === "denied") return NextResponse.json({ error: "access_denied" }, { status: 400 });
  if (outcome.kind === "already_delivered") return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  if (!device.user_id) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });

  // Claim delivery atomically: only one poll can flip APPROVED -> ACTIVE and receive the key.
  const claimed = await prisma.cliDevice.updateMany({
    where: { id: device.id, status: "APPROVED" },
    data: { status: "ACTIVE", last_seen_at: polledAt, last_polled_at: polledAt },
  });
  if (claimed.count !== 1) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: device.user_id } });
  if (!user || user.status !== "ACTIVE") return NextResponse.json({ error: "access_denied" }, { status: 400 });

  const key = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      user_id: user.id,
      label: `CLI: ${device.name ?? "device"}`.slice(0, 60),
      key_prefix: key.prefix,
      key_hash: key.hash,
    },
  });
  await prisma.cliDevice.update({ where: { id: device.id }, data: { api_key_id: row.id } });

  return NextResponse.json({
    access_token: key.raw,
    token_type: "Bearer",
    user: { id: user.id, email: user.email, name: user.name },
  });
}
