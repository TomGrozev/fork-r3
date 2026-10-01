// Login tokens → HttpOnly session cookies (REQUIRE_LOGIN). Tokens are shown once
// and stored hashed; the per-user API token (config.ts getToken) is separate.

import type { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CookieOptions } from "hono/utils/cookie";
import type { AuthTokenInfo } from "../shared/types.ts";
import { nowIso } from "./ids.ts";

// The session cookie name. HttpOnly, so JS never reads it (the SPA authenticates by
// its mere presence, sent automatically on same-origin requests + EventSource).
export const COOKIE_NAME = "r3_session";

// Session lifetime — 30 days, in zellij's ~4-week ballpark. A revoked login token
// kills its sessions immediately (revokeToken); this only bounds how long an
// un-revoked one stays logged in.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_AUTH_TOKEN_IDLE_DAYS = 14;

// sha256 hex of a secret — the at-rest form of both login tokens and cookie values.
// A fast hash is right here: these are 128-256-bit random secrets, not low-entropy
// passwords, so there's nothing to brute-force and no salt/KDF needed.
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Database injection keeps authentication independent of review/artifact bootstrap.
// The schema migration preserves these hash-only tables without changing cookies.
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => string = nowIso,
    private readonly tokenIdleDays: number = DEFAULT_AUTH_TOKEN_IDLE_DAYS,
  ) {
    if (!Number.isSafeInteger(tokenIdleDays) || tokenIdleDays < 1)
      throw new Error("authTokenIdleDays must be a positive integer");
  }

  createLoginToken(label: string | null): { token: string; info: AuthTokenInfo } {
    const token = `r3tok_${randomBytes(24).toString("hex")}`;
    const id = `authtok_${randomUUID().replaceAll("-", "")}`;
    const createdAt = this.clock();
    this.db
      .query("INSERT INTO auth_tokens(id, label, token_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, label, hashSecret(token), createdAt);
    return { token, info: { id, label, createdAt, lastUsedAt: null } };
  }

  verifyLogin(token: string): { tokenId: string } | null {
    if (!token) return null;
    return this.db.transaction(() => {
      this.expireTokens();
      const row = this.db
        .query<{ id: string }, [string]>(
          "SELECT id FROM auth_tokens WHERE token_hash = ? AND revoked_at IS NULL",
        )
        .get(hashSecret(token));
      if (!row) return null;
      this.db
        .query("UPDATE auth_tokens SET last_used_at = ? WHERE id = ?")
        .run(this.clock(), row.id);
      return { tokenId: row.id };
    })();
  }

  mintSession(tokenId: string): { cookieValue: string; maxAgeSeconds: number } {
    this.expireTokens();
    const cookieValue = randomBytes(32).toString("base64url");
    this.db.transaction(() => {
      if (
        !this.db.query("SELECT 1 FROM auth_tokens WHERE id = ? AND revoked_at IS NULL").get(tokenId)
      ) {
        throw new Error("Cannot create a session for an invalid or revoked login token");
      }
      const createdAt = this.clock();
      this.db
        .query(
          "INSERT INTO auth_sessions(id, token_id, session_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          `sess_${randomUUID().replaceAll("-", "")}`,
          tokenId,
          hashSecret(cookieValue),
          createdAt,
          new Date(Date.parse(createdAt) + SESSION_TTL_MS).toISOString(),
        );
      this.db.query("UPDATE auth_tokens SET last_used_at = ? WHERE id = ?").run(createdAt, tokenId);
    })();
    return { cookieValue, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) };
  }

  sessionValid(cookieValue: string | undefined): boolean {
    return this.sessionTokenId(cookieValue) !== null;
  }

  sessionTokenId(cookieValue: string | undefined): string | null {
    if (!cookieValue) return null;
    return this.db.transaction(() => {
      this.expireTokens();
      const usedAt = this.clock();
      const row = this.db
        .query<{ id: string }, [string, string]>(`SELECT t.id FROM auth_sessions s
      JOIN auth_tokens t ON t.id = s.token_id WHERE s.session_hash = ? AND s.expires_at > ? AND t.revoked_at IS NULL`)
        .get(hashSecret(cookieValue), usedAt);
      if (!row) return null;
      this.db.query("UPDATE auth_tokens SET last_used_at = ? WHERE id = ?").run(usedAt, row.id);
      return row.id;
    })();
  }

  destroySession(cookieValue: string | undefined): void {
    if (cookieValue)
      this.db
        .query("DELETE FROM auth_sessions WHERE session_hash = ?")
        .run(hashSecret(cookieValue));
  }

  listTokens(): AuthTokenInfo[] {
    this.expireTokens();
    return this.db
      .query<AuthTokenInfo, []>(`SELECT id, label, created_at AS createdAt,
      last_used_at AS lastUsedAt FROM auth_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC, rowid DESC`)
      .all();
  }

  revokeToken(id: string): boolean {
    return this.db.transaction(() => {
      const result = this.db
        .query("UPDATE auth_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .run(this.clock(), id);
      if (result.changes) this.db.query("DELETE FROM auth_sessions WHERE token_id = ?").run(id);
      return result.changes > 0;
    })();
  }

  revokeAllTokens(): number {
    return this.db.transaction(() => {
      const tokens = this.listTokens();
      for (const token of tokens) this.revokeToken(token.id);
      return tokens.length;
    })();
  }

  expireSessions(): void {
    this.db.query("DELETE FROM auth_sessions WHERE expires_at <= ?").run(this.clock());
  }

  // Revoke before recording use so an overdue login or cookie cannot revive a token.
  // Keep automatically revoked tokens and their sessions until startup cleanup.
  expireTokens(): number {
    const expiredAt = this.clock();
    return this.db
      .query(`UPDATE auth_tokens SET revoked_at = ? WHERE revoked_at IS NULL
        AND julianday(COALESCE(last_used_at, created_at)) <= julianday(?) - ?`)
      .run(expiredAt, expiredAt, this.tokenIdleDays).changes;
  }

  cleanupOnStartup(): void {
    this.db.transaction(() => {
      this.expireTokens();
      this.expireSessions();
      this.db.exec(`DELETE FROM auth_sessions WHERE token_id IN (
        SELECT id FROM auth_tokens WHERE revoked_at IS NOT NULL
      ); DELETE FROM auth_tokens WHERE revoked_at IS NOT NULL`);
    })();
  }
}

// Cookie attributes. `secure` is set when the browser<->edge leg is HTTPS (e.g.
// `tailscale serve` terminates TLS); the daemon speaks plain HTTP, so the caller
// decides from X-Forwarded-Proto. SameSite=Strict means the cookie never rides a
// cross-site request — closing CSRF/rebinding reads on top of the existing Host
// allowlist + same-origin mutation guard.
export function cookieOptions(secure: boolean, maxAgeSeconds: number): CookieOptions {
  return { httpOnly: true, path: "/", sameSite: "Strict", secure, maxAge: maxAgeSeconds };
}
