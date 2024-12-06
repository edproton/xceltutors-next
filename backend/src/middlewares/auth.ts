import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { Env } from "@/lib/facotry";
import { deleteSessionCookie } from "@/lib/cookies";
import { HTTPException } from "hono/http-exception";
import {
  validateSessionToken,
  type SessionValidationResult,
} from "@/lib/sessions";
import type { User, Session, ProviderAccount } from "@prisma/client";

declare module "hono" {
  interface ContextVariableMap {
    user: User | null;
    session: (Session & { providerAccount: ProviderAccount }) | null;
    providerAccount: ProviderAccount | null;
  }
}

// Authentication middleware
export const authMiddleware = async (c: Context<Env>, next: Next) => {
  if (c.req.method === "OPTIONS") {
    return next();
  }

  try {
    const sessionToken = getCookie(c, "session");
    if (!sessionToken) {
      throw new HTTPException(401, { message: "Authentication required" });
    }

    const validation: SessionValidationResult =
      await validateSessionToken(sessionToken);

    if (!validation.session || !validation.user) {
      deleteSessionCookie(c);
      throw new HTTPException(401, { message: "Invalid or expired session" });
    }

    c.set("user", validation.user);
    c.set("session", validation.session);
    c.set("providerAccount", validation.providerAccount);

    return next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, { message: "Internal server error" });
  }
};
