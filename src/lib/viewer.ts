import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { userAgent } from "next/server";
import { jwtVerify } from "jose";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { findBrowserUser, resolveBrowserUser, withBrowserTransaction, type BrowserIdentity } from "./browserAccounts.js";
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

export async function getBrowserIdentity(): Promise<BrowserIdentity | null> {
  const jar = await cookies();
  const token = jar.get(BROWSER_COOKIE)?.value;
  if (!isBrowserToken(token)) return null;
  const agent = userAgent({ headers: await headers() });
  const browser = agent.browser.name?.replace(/^Mobile | Mobile$/g, "");
  const model = agent.device.model;
  const platform = model === "iPhone" || model === "iPad" || model === "iPod" ? model : agent.os.name;
  const label = [browser, platform].filter(Boolean).join(" · ");
  return { hash: hashToken(token), legacyId: await legacyUserId(jar.get(LEGACY_SESSION_COOKIE)?.value), label: label || null };
}

async function resolveViewerId(browser: BrowserIdentity | null): Promise<number | null> {
  if (!browser) return null;
  const id = await findBrowserUser(pool, browser);
  if (id !== null) return id;

  // Обычный визит без истории не создаёт записей и не берёт блокировку.
  const legacy = await pool.query("SELECT 1 FROM users WHERE browser_token = $1 OR id = $2", [browser.hash, browser.legacyId]);
  if (!legacy.rowCount) return null;
  return withBrowserTransaction(db => resolveBrowserUser(db, browser, false));
}

export async function getViewerId(): Promise<number | null> {
  return resolveViewerId(await getBrowserIdentity());
}

export async function getViewerDevices() {
  const browser = await getBrowserIdentity();
  if (!browser || await resolveViewerId(browser) === null) return [];
  const { rows } = await pool.query<{ label: string | null; last_seen_at: Date; current: boolean }>(
    `SELECT linked.device_label AS label, linked.last_seen_at, linked.token_hash = $1 AS current
     FROM browsers viewer JOIN browsers linked ON linked.user_id = viewer.user_id
     WHERE viewer.token_hash = $1
     ORDER BY current DESC, linked.last_seen_at DESC, linked.token_hash`,
    [browser.hash],
  );
  return rows;
}

export async function withViewerWrite<T>(run: (db: PoolClient, id: number) => Promise<T>): Promise<T | null> {
  const browser = await getBrowserIdentity();
  if (!browser) return null;
  return withBrowserTransaction(async db => {
    const id = await resolveBrowserUser(db, browser, true);
    return id === null ? null : run(db, id);
  });
}
