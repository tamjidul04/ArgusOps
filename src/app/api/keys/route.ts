import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") || "usr_tamjid_master";

    const keys = await prisma.apiKey.findMany({
      where: { user_id: userId },
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
  } catch (error) {
    console.error("API Keys GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch API keys." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { label = "Local PC Daemon Key", userId = "usr_tamjid_master" } = body;

    // Generate standard ArgusOps API key
    const rawSecret = crypto.randomBytes(24).toString("hex");
    const prefix = "argus_live_";
    const fullKey = `${prefix}${rawSecret}`;
    const keyHash = crypto.createHash("sha256").update(fullKey).digest("hex");

    const newKey = await prisma.apiKey.create({
      data: {
        user_id: userId,
        label,
        key_prefix: prefix,
        key_hash: keyHash,
        last_used_at: new Date(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "API Key created successfully. Store this key safely.",
        key: {
          id: newKey.id,
          label: newKey.label,
          full_key: fullKey,
          key_prefix: newKey.key_prefix,
          created_at: newKey.created_at,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("API Keys POST error:", error);
    return NextResponse.json(
      { error: "Internal server error creating API key." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const keyId = searchParams.get("id");

    if (!keyId) {
      return NextResponse.json({ error: "Key ID is required." }, { status: 400 });
    }

    await prisma.apiKey.delete({
      where: { id: keyId },
    });

    return NextResponse.json({
      success: true,
      message: "API key revoked and deleted.",
    });
  } catch (error) {
    console.error("API Keys DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to revoke API key." },
      { status: 500 }
    );
  }
}

