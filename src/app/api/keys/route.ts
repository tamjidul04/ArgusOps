import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateApiKey, requireAuth } from "@/lib/auth";

const MAX_ACTIVE_KEYS = 20;

/** List the signed-in user's keys. Keys are never returned in full after creation. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const keys = await prisma.apiKey.findMany({
    where: { user_id: auth.user.id, revoked_at: null },
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({
    success: true,
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      key_prefix: k.key_prefix,
      masked_key: `${k.key_prefix}••••••••••••${k.key_hash.slice(-4)}`,
      last_used_at: k.last_used_at,
      created_at: k.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  // API keys cannot mint more API keys: only an interactive session can.
  if (auth.via !== "session") {
    return NextResponse.json({ error: "Sign in to create API keys." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : "Local PC Daemon Key";

  const active = await prisma.apiKey.count({ where: { user_id: auth.user.id, revoked_at: null } });
  if (active >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      { error: `You can have at most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` },
      { status: 400 }
    );
  }

  const { raw, hash, prefix } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: { user_id: auth.user.id, label, key_prefix: prefix, key_hash: hash },
  });

  return NextResponse.json(
    {
      success: true,
      message: "API key created. Store it now, it will not be shown again.",
      key: {
        id: created.id,
        label: created.label,
        full_key: raw,
        key_prefix: created.key_prefix,
        created_at: created.created_at,
      },
    },
    { status: 201 }
  );
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.via !== "session") {
    return NextResponse.json({ error: "Sign in to revoke API keys." }, { status: 403 });
  }

  const keyId = new URL(req.url).searchParams.get("id");
  if (!keyId) return NextResponse.json({ error: "Key ID is required." }, { status: 400 });

  // Scoped to the owner: a user can never revoke someone else's key.
  const result = await prisma.apiKey.updateMany({
    where: { id: keyId, user_id: auth.user.id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Key not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, message: "API key revoked." });
}
