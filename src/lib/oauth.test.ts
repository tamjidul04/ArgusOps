import { describe, it, expect } from "vitest";
import {
  pkceChallenge,
  safeNextPath,
  buildAuthUrl,
  redirectUri,
  statesMatch,
  isProvider,
  randomToken,
} from "./oauth";

describe("pkce", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});

describe("safeNextPath", () => {
  it("allows same-site paths", () => {
    expect(safeNextPath("/dashboard/billing?x=1")).toBe("/dashboard/billing?x=1");
  });
  it("blocks open redirects", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil.com", "", null, undefined, "/a\r\nSet-Cookie: x=1"]) {
      expect(safeNextPath(bad as string | null | undefined)).toBe("/dashboard");
    }
  });
});

describe("buildAuthUrl", () => {
  it("builds a Google URL with PKCE and state", () => {
    const u = new URL(
      buildAuthUrl("google", { clientId: "cid", redirectUri: "http://localhost:3000/cb", state: "s1", challenge: "ch" })
    );
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("state")).toBe("s1");
    expect(u.searchParams.get("code_challenge")).toBe("ch");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
  });
  it("builds a GitHub URL without PKCE", () => {
    const u = new URL(buildAuthUrl("github", { clientId: "cid", redirectUri: "http://x/cb", state: "s2", challenge: "ch" }));
    expect(u.searchParams.get("code_challenge")).toBeNull();
    expect(u.searchParams.get("scope")).toBe("read:user user:email");
  });
});

describe("misc", () => {
  it("builds callback URLs without double slashes", () => {
    expect(redirectUri("https://app.example.com/", "github")).toBe("https://app.example.com/api/auth/oauth/github/callback");
  });
  it("compares state in constant time and rejects missing values", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("abc", null)).toBe(false);
  });
  it("recognises only supported providers", () => {
    expect(isProvider("google")).toBe(true);
    expect(isProvider("github")).toBe(true);
    expect(isProvider("facebook")).toBe(false);
  });
  it("generates unique url-safe tokens", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomToken()).not.toBe(a);
  });
});
