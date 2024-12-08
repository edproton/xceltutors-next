import { setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { env } from "@/config";

export function setSessionCookie(
  c: Context,
  token: string,
  expiresAt: Date
): void {
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export function deleteSessionCookie(c: Context): void {
  deleteCookie(c, "session", {
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}
