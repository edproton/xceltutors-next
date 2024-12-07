import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { deleteSessionCookie } from "@/lib/cookies";
import { HTTPException } from "hono/http-exception";
import { validateSessionToken, SessionWithUser } from "@/lib/sessions";
import type { User } from "@prisma/client";

declare module "hono" {
  interface ContextVariableMap {
    user: User | null;
    session: SessionWithUser | undefined;
  }
}

const BEARER_PREFIX = "Bearer ";
const SESSION_HEADER = "Authorization";

// Authentication middleware
export const authMiddleware = async (c: Context, next: Next) => {
  if (c.req.method === "OPTIONS") {
    return next();
  }

  try {
    let sessionToken = c.req.header(SESSION_HEADER);

    console.log("sessionToken", sessionToken);
    if (sessionToken) {
      if (!sessionToken.startsWith(BEARER_PREFIX)) {
        throw new HTTPException(401, {
          message: "Invalid Authorization header format. Must use Bearer token",
        });
      }

      sessionToken = sessionToken.slice(BEARER_PREFIX.length);

      console.log("HEADER sessionToken", sessionToken);
    } else {
      sessionToken = getCookie(c, "session");
    }

    if (!sessionToken) {
      throw new HTTPException(401, { message: "Authentication required" });
    }

    const session = await validateSessionToken(sessionToken.trim());

    if (!session) {
      if (getCookie(c, "session")) {
        deleteSessionCookie(c);
      }
      throw new HTTPException(401, { message: "Invalid or expired session" });
    }

    c.set("user", session.user);
    c.set("session", session);
    return next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: "Internal server error" });
  }
};
