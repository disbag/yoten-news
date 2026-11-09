export const BROWSER_COOKIE = "yoten_browser";

export const BROWSER_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 400 * 24 * 60 * 60,
  path: "/",
} as const;

export function isBrowserToken(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
