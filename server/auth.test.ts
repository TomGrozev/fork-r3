import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createArtifactTables } from "./artifact-schema.ts";
import { AuthService, cookieOptions } from "./auth.ts";

let db: Database;
let auth: AuthService;
let time: string;
beforeEach(() => {
  db = new Database(":memory:");
  createArtifactTables(db);
  time = "2026-09-01T00:00:00.000Z";
  auth = new AuthService(db, () => time);
});
afterEach(() => db.close());

describe("injected authentication store", () => {
  test("login and session values are generated once and only their digests are persisted", () => {
    const issued = auth.createLoginToken("Test access");
    expect(auth.verifyLogin(issued.token)?.tokenId).toBe(issued.info.id);
    const session = auth.mintSession(issued.info.id);
    expect(auth.sessionValid(session.cookieValue)).toBe(true);
    expect(auth.sessionTokenId(session.cookieValue)).toBe(issued.info.id);
    expect(auth.listTokens()).toEqual([{ ...issued.info, lastUsedAt: time }]);
    const stored =
      JSON.stringify(db.query("SELECT * FROM auth_tokens").all()) +
      JSON.stringify(db.query("SELECT * FROM auth_sessions").all());
    expect(stored.includes(issued.token)).toBe(false);
    expect(stored.includes(session.cookieValue)).toBe(false);
    expect(auth.sessionValid(undefined)).toBe(false);
    auth.destroySession(session.cookieValue);
    expect(auth.sessionValid(session.cookieValue)).toBe(false);
  });

  test("revocation removes sessions atomically and prevents subsequent session minting", () => {
    const issued = auth.createLoginToken(null);
    const session = auth.mintSession(issued.info.id);
    expect(auth.revokeToken(issued.info.id)).toBe(true);
    expect(auth.revokeToken(issued.info.id)).toBe(false);
    expect(auth.verifyLogin(issued.token)).toBeNull();
    expect(auth.sessionValid(session.cookieValue)).toBe(false);
    expect(() => auth.mintSession(issued.info.id)).toThrow("invalid or revoked");
    expect(auth.listTokens()).toEqual([]);
    expect(db.query("SELECT * FROM auth_sessions").all()).toEqual([]);
  });

  test("expiry is enforced before housekeeping and a fresh service uses the same persisted credentials", () => {
    auth = new AuthService(db, () => time, 45);
    const issued = auth.createLoginToken(null);
    const session = auth.mintSession(issued.info.id);
    auth = new AuthService(db, () => time, 45);
    expect(auth.sessionValid(session.cookieValue)).toBe(true);
    time = "2026-10-01T00:00:00.000Z";
    expect(auth.sessionValid(session.cookieValue)).toBe(false);
    auth.expireSessions();
    expect(db.query("SELECT * FROM auth_sessions").all()).toEqual([]);
    auth.createLoginToken("Second access");
    expect(auth.revokeAllTokens()).toBe(2);
    expect(auth.revokeAllTokens()).toBe(0);
    expect(cookieOptions(true, 10)).toEqual({
      httpOnly: true,
      path: "/",
      sameSite: "Strict",
      secure: true,
      maxAge: 10,
    });
  });

  test("never-used tokens expire at the idle boundary and remain softly revoked until startup", () => {
    const issued = auth.createLoginToken(null);
    time = "2026-09-14T23:59:59.999Z";
    expect(auth.expireTokens()).toBe(0);
    expect(auth.listTokens()).toEqual([issued.info]);
    time = "2026-09-15T00:00:00.000Z";
    expect(auth.expireTokens()).toBe(1);
    expect(auth.expireTokens()).toBe(0);
    expect(auth.listTokens()).toEqual([]);
    expect(auth.verifyLogin(issued.token)).toBeNull();
    expect(db.query("SELECT last_used_at, revoked_at FROM auth_tokens").get()).toEqual({
      last_used_at: null,
      revoked_at: time,
    });
    auth = new AuthService(db, () => time, 45);
    expect(auth.verifyLogin(issued.token)).toBeNull();
    auth.cleanupOnStartup();
    expect(db.query("SELECT * FROM auth_tokens").all()).toEqual([]);
  });

  test("successful logins extend inactivity while overdue login attempts cannot revive tokens", () => {
    const issued = auth.createLoginToken(null);
    time = "2026-09-14T00:00:00.000Z";
    expect(auth.verifyLogin(issued.token)).toEqual({ tokenId: issued.info.id });
    expect(auth.listTokens()[0].lastUsedAt).toBe(time);
    time = "2026-09-27T23:59:59.999Z";
    expect(auth.listTokens()).toHaveLength(1);
    time = "2026-09-28T00:00:00.000Z";
    expect(auth.verifyLogin(issued.token)).toBeNull();
    expect(db.query("SELECT last_used_at, revoked_at FROM auth_tokens").get()).toEqual({
      last_used_at: "2026-09-14T00:00:00.000Z",
      revoked_at: time,
    });
  });

  test("every valid session refreshes its token without refreshing unrelated or expired sessions", () => {
    const issued = auth.createLoginToken(null);
    const first = auth.mintSession(issued.info.id);
    const second = auth.mintSession(issued.info.id);
    const unrelated = auth.createLoginToken("Unused");
    time = "2026-09-14T00:00:00.000Z";
    expect(auth.sessionValid(first.cookieValue)).toBe(true);
    time = "2026-09-27T00:00:00.000Z";
    expect(auth.sessionTokenId(second.cookieValue)).toBe(issued.info.id);
    expect(auth.listTokens()).toEqual([{ ...issued.info, lastUsedAt: time }]);
    expect(auth.verifyLogin(unrelated.token)).toBeNull();
    time = "2026-10-01T00:00:00.000Z";
    expect(auth.sessionValid(first.cookieValue)).toBe(false);
    expect(auth.listTokens()[0].lastUsedAt).toBe("2026-09-27T00:00:00.000Z");
  });

  test("idle cookies are denied before housekeeping without deleting data until startup", () => {
    const issued = auth.createLoginToken(null);
    const session = auth.mintSession(issued.info.id);
    time = "2026-09-15T00:00:00.000Z";
    expect(auth.sessionValid(session.cookieValue)).toBe(false);
    expect(() => auth.mintSession(issued.info.id)).toThrow("invalid or revoked");
    expect(auth.listTokens()).toEqual([]);
    expect(db.query("SELECT revoked_at FROM auth_tokens").get()).toEqual({ revoked_at: time });
    expect(db.query("SELECT id FROM auth_sessions").all()).toHaveLength(1);
    auth.cleanupOnStartup();
    expect(db.query("SELECT * FROM auth_tokens").all()).toEqual([]);
    expect(db.query("SELECT * FROM auth_sessions").all()).toEqual([]);
  });

  test("custom inactivity settings apply to login, session minting and startup cleanup", () => {
    auth = new AuthService(db, () => time, 2);
    const expired = auth.createLoginToken(null);
    time = "2026-09-02T00:00:00.000Z";
    const recent = auth.createLoginToken(null);
    time = "2026-09-03T00:00:00.000Z";
    expect(() => auth.mintSession(expired.info.id)).toThrow("invalid or revoked");
    expect(auth.verifyLogin(expired.token)).toBeNull();
    auth.cleanupOnStartup();
    expect(auth.verifyLogin(recent.token)).toEqual({ tokenId: recent.info.id });
    expect(auth.listTokens()).toEqual([{ ...recent.info, lastUsedAt: time }]);
    expect(db.query("SELECT id FROM auth_tokens").all()).toEqual([{ id: recent.info.id }]);
  });
});
