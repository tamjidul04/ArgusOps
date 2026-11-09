import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSession,
  hashPassword,
  isLegacyHash,
  verifyPassword,
  verifyTotp,
} from "@/lib/auth";
import { clientIp, rateLimit, resetRateLimit } from "@/lib/rate-limit";

const GENERIC_FAILURE = "Invalid email or password.";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, password, otp } = body as {
      email?: unknown;
      password?: unknown;
      otp?: unknown;
    };

    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Brute-force damping: 8 attempts / 10 min per ip+email, 40 / 10 min per ip.
    const ip = clientIp(req);
    const keyA = `login:${ip}:${trimmedEmail}`;
    const limited = rateLimit(keyA, 8, 10 * 60_000);
    const limitedIp = rateLimit(`login-ip:${ip}`, 40, 10 * 60_000);
    if (!limited.allowed || !limitedIp.allowed) {
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      include: { subscription: true },
    });

    // Same response for unknown user and wrong password, so emails cannot be enumerated.
    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
    }

    if (user.status === "BANNED") {
      return NextResponse.json(
        { error: "This account has been suspended by platform administration." },
        { status: 403 }
      );
    }

    if (user.two_factor_enabled && user.two_factor_secret) {
      if (typeof otp !== "string" || !otp) {
        return NextResponse.json(
          { require_2fa: true, message: "Two-factor authentication code required." },
          { status: 200 }
        );
      }
      if (!verifyTotp(user.two_factor_secret, otp)) {
        return NextResponse.json({ error: "Invalid authenticator code." }, { status: 401 });
      }
    }

    // Upgrade legacy PBKDF2 hashes to scrypt on successful login.
    if (isLegacyHash(user.password_hash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { password_hash: hashPassword(password) },
      });
    }

    resetRateLimit(keyA);
    await createSession(user.id, req.headers.get("user-agent"));

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan_id: user.subscription?.plan_id,
      },
      redirectUrl: user.role === "ADMIN" ? "/admin" : "/dashboard",
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "An error occurred during authentication." }, { status: 500 });
  }
}
