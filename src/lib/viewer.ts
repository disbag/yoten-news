import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { findBrowserUser, resolveBrowserUser, withBrowserTransaction } from "./browserAccounts.js";
import { BROWSER_COOKIE, isBrowserToken } from "./browserCookie.js";

export const LEGACY_SESSION_COOKIE = "session";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Последние старые JWT истекают 24 января 2027.
async function legacyUserId(token: string | undefined): Promise<number | null> {
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return typeof payload.userId === "number" && Number.isSafeInteger(payload.userId) ? payload.userId : null;
  } catch {
    return null;
  }
}

export async function getBrowserIdentity() {
  const jar = await cookies();
  const token = jar.get(BROWSER_COOKIE)?.value;
  if (!isBrowserToken(token)) return null;
  return { hash: hashToken(token), legacyId: await legacyUserId(jar.get(LEGACY_SESSION_COOKIE)?.value) };
}

export async function getViewerId(): Promise<number | null> {
  const browser = await getBrowserIdentity();
  if (!browser) return null;
  const id = await findBrowserUser(pool, browser.hash);
  if (id !== null) return id;

  // Обычный визит без истории не создаёт записей и не берёт блокировку.
  const legacy = await pool.query("SELECT 1 FROM users WHERE browser_token = $1 OR id = $2", [browser.hash, browser.legacyId]);
  if (!legacy.rowCount) return null;
  return withBrowserTransaction(db => resolveBrowserUser(db, browser.hash, browser.legacyId, false));
}

export async function withViewerWrite<T>(run: (db: PoolClient, id: number) => Promise<T>): Promise<T | null> {
  const browser = await getBrowserIdentity();
  if (!browser) return null;
  return withBrowserTransaction(async db => {
    const id = await resolveBrowserUser(db, browser.hash, browser.legacyId, true);
    return id === null ? null : run(db, id);
  });
}
