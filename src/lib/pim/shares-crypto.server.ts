import { randomBytes, pbkdf2Sync, createHmac, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string, salt: string): string {
  // Cloudflare Workers PBKDF2 tops out at 100_000 iterations.
  return pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
}

export function genToken(): string {
  return randomBytes(18).toString("base64url");
}

export function genSalt(): string {
  return randomBytes(16).toString("hex");
}

export function signSession(token: string, passwordUpdatedAt: string): string {
  const secret = process.env.SHARE_SESSION_SECRET!;
  const issuedAt = Date.now();
  const payload = `${token}.${passwordUpdatedAt}.${issuedAt}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${issuedAt}.${sig}`;
}

export function verifySession(
  session: string,
  token: string,
  passwordUpdatedAt: string,
  maxAgeMs = 1000 * 60 * 60 * 24 * 30,
): boolean {
  const secret = process.env.SHARE_SESSION_SECRET!;
  const [issuedAtRaw, sig] = session.split(".");
  if (!issuedAtRaw || !sig) return false;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > maxAgeMs) return false;
  const expected = createHmac("sha256", secret)
    .update(`${token}.${passwordUpdatedAt}.${issuedAt}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passwordsMatch(password: string, salt: string, expectedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const attempt = Buffer.from(hashPassword(password, salt), "hex");
  if (expected.length !== attempt.length) return false;
  return timingSafeEqual(expected, attempt);
}