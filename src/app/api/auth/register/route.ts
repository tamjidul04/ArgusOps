import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword, validatePasswordStrength } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createUserOnFreePlan, PlansNotSeededError } from "@/lib/provision";

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(`register:${clientIp(req)}`, 10, 60 * 60_000);
    if (!limited.allowed) {
      return NextResponse.json(
        { error: "Too many sign-ups from this address. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { name, email, password } = body as { name?: unknown; email?: unknown; password?: unknown };

    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }
    if (typeof password !== "string") {
      return NextResponse.json({ error: "Password is required." }, { status: 400 });
    }
    const weak = validatePasswordStrength(password);
    if (weak) return NextResponse.json({ error: weak }, { status: 400 });

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName =
      (typeof name === "string" ? name.trim().slice(0, 80) : "") || trimmedEmail.split("@")[0];

    const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email address already exists. Please sign in." },
        { status: 409 }
      );
    }

    let user;
    try {
      user = await createUserOnFreePlan({
        email: trimmedEmail,
        name: trimmedName,
        passwordHash: hashPassword(password),
      });
    } catch (e) {
      if (e instanceof PlansNotSeededError) {
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      throw e;
    }

    await createSession(user.id, req.headers.get("user-agent"));

    return NextResponse.json(
      {
        success: true,
        message: `Free plan provisioned: ${user.subscription?.max_agents} concurrent agents and ${user.subscription?.free_tokens.toLocaleString()} tokens.`,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          free_tokens: user.subscription?.free_tokens,
          max_agents: user.subscription?.max_agents,
        },
        redirectUrl: "/dashboard",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while provisioning your account." },
      { status: 500 }
    );
  }
}
