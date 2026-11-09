import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/oauth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL_S,
  generateDeviceCode,
  generateUserCode,
} from "@/lib/device-flow";

/** Step 1 of `argus login`: the CLI asks for a device code and a short code to show the user. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(`device-code:${clientIp(req)}`, 20, 10 * 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "slow_down", error_description: "Too many pairing requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Unnamed device";

  // user_code is unique; retry on the (rare) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const device_code = generateDeviceCode();
    const user_code = generateUserCode();
    const created = await prisma.cliDevice.createMany({
      data: [
        {
          device_code,
          user_code,
          name,
          status: "PENDING",
          expires_at: new Date(Date.now() + DEVICE_CODE_TTL_MS),
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 1) {
      const base = appBaseUrl(req);
      return NextResponse.json({
        device_code,
        user_code,
        verification_uri: `${base}/device`,
        verification_uri_complete: `${base}/device?code=${user_code}`,
        expires_in: DEVICE_CODE_TTL_MS / 1000,
        interval: DEVICE_POLL_INTERVAL_S,
      });
    }
  }
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}
