import { prisma } from "@/lib/prisma";
import { createUserOnFreePlan } from "@/lib/provision";
import type { OAuthProfile, ProviderId } from "@/lib/oauth";

/** Stored for accounts that have no password. It matches no hash format, so verifyPassword() always fails. */
export const UNUSABLE_PASSWORD = "oauth$none";

export type OAuthLoginResult =
  | { ok: true; userId: string; isNewUser: boolean; linked: boolean }
  | { ok: false; reason: "email_unverified" | "banned" | "two_factor_required" };

/**
 * Resolves an OAuth identity to a user.
 *  1. Known (provider, account id)        -> that user.
 *  2. Unknown id, email matches a user    -> link, after neutralising any password (see below).
 *  3. Otherwise                           -> create a Free-plan account.
 *
 * Only identities whose email the provider has verified are accepted.
 *
 * Why linking resets the password: sign-up does not verify email yet, so someone could have
 * pre-registered a victim's address with a password they know. When the real owner later signs
 * in with Google/GitHub we link to that account, so we must also invalidate that password and
 * drop its sessions, or the pre-registrant would keep access. Accounts with 2FA enabled are never
 * auto-linked (that would bypass the second factor); those users must sign in with their password.
 */
export async function signInWithOAuth(provider: ProviderId, profile: OAuthProfile): Promise<OAuthLoginResult> {
  if (!profile.email || !profile.emailVerified) return { ok: false, reason: "email_unverified" };
  const email = profile.email.toLowerCase();

  const existingLink = await prisma.oAuthAccount.findUnique({
    where: {
      provider_provider_account_id: { provider, provider_account_id: profile.providerAccountId },
    },
    include: { user: true },
  });
  if (existingLink) {
    if (existingLink.user.status !== "ACTIVE") return { ok: false, reason: "banned" };
    return { ok: true, userId: existingLink.user_id, isNewUser: false, linked: false };
  }

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    if (byEmail.status !== "ACTIVE") return { ok: false, reason: "banned" };
    if (byEmail.two_factor_enabled) return { ok: false, reason: "two_factor_required" };

    await prisma.$transaction([
      prisma.oAuthAccount.create({
        data: { user_id: byEmail.id, provider, provider_account_id: profile.providerAccountId, email },
      }),
      prisma.user.update({ where: { id: byEmail.id }, data: { password_hash: UNUSABLE_PASSWORD } }),
      prisma.session.deleteMany({ where: { user_id: byEmail.id } }),
    ]);
    return { ok: true, userId: byEmail.id, isNewUser: false, linked: true };
  }

  const user = await createUserOnFreePlan({
    email,
    name: profile.name.trim().slice(0, 80) || email.split("@")[0],
    passwordHash: UNUSABLE_PASSWORD,
  });
  await prisma.oAuthAccount.create({
    data: { user_id: user.id, provider, provider_account_id: profile.providerAccountId, email },
  });
  return { ok: true, userId: user.id, isNewUser: true, linked: false };
}
