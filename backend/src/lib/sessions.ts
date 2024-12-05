import { prisma } from "./prisma";
import {
  encodeBase32LowerCaseNoPadding,
  encodeHexLowerCase,
} from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import type { User, Session, ProviderAccount } from "@prisma/client";

// Time constants (in milliseconds)
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Session duration constants
const DEFAULT_SESSION_DURATION = MS_PER_DAY * 30; // 30 days
const SESSION_EXTENSION_THRESHOLD = MS_PER_DAY * 15; // 15 days remaining

// Generate a cryptographically secure session token
export function generateSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = encodeBase32LowerCaseNoPadding(bytes);
  console.log(`[Session Manager] Generated token: ${token}`);
  return token;
}

// Create a new session
export async function createSession(
  token: string,
  userId: number,
  providerAccountId: number,
  expirationDuration = DEFAULT_SESSION_DURATION
): Promise<Session> {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  const expiresAt = new Date(Date.now() + expirationDuration);

  console.log(
    `[Session Manager] Creating session for user ${userId}, providerAccount ${providerAccountId}, expiresAt: ${expiresAt}`
  );

  const session: Session = {
    id: sessionId,
    userId,
    providerAccountId,
    expiresAt,
  };

  try {
    await prisma.session.create({ data: session });
    console.log(
      `[Session Manager] Session created successfully. Session ID: ${sessionId}`
    );
    return session;
  } catch (error) {
    console.error(
      `[Session Manager] Failed to create session for user ${userId}:`,
      error
    );
    throw new Error("Could not create session");
  }
}

// Validate a session token
export async function validateSessionToken(
  token: string
): Promise<SessionValidationResult> {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  console.log(`[Session Manager] Validating session with ID: ${sessionId}`);

  try {
    const sessionRecord = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
        providerAccount: true, // Include provider account for better context
      },
    });

    if (!sessionRecord) {
      console.warn(`[Session Manager] Session with ID ${sessionId} not found.`);
      return { session: null, user: null, providerAccount: null };
    }

    const { user, providerAccount, ...session } = sessionRecord;

    if (Date.now() >= session.expiresAt.getTime()) {
      console.warn(
        `[Session Manager] Session with ID ${sessionId} has expired. Deleting session.`
      );
      await prisma.session.delete({ where: { id: sessionId } });
      return { session: null, user: null, providerAccount: null };
    }

    // Extend the session if it's close to expiring (15 days remaining)
    if (
      Date.now() >=
      session.expiresAt.getTime() - SESSION_EXTENSION_THRESHOLD
    ) {
      session.expiresAt = new Date(Date.now() + DEFAULT_SESSION_DURATION);
      console.log(
        `[Session Manager] Extending session expiration for ID ${sessionId} to ${session.expiresAt}`
      );
      await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: session.expiresAt },
      });
    }

    console.log(`[Session Manager] Session with ID ${sessionId} is valid.`);

    // Explicitly merge providerAccount into session
    return {
      session: { ...session, providerAccount },
      user,
      providerAccount,
    };
  } catch (error) {
    console.error(
      `[Session Manager] Error validating session with ID ${sessionId}:`,
      error
    );
    throw new Error("Could not validate session");
  }
}

// Invalidate a session by ID
export async function invalidateSession(sessionId: string): Promise<void> {
  console.log(`[Session Manager] Invalidating session with ID: ${sessionId}`);

  try {
    await prisma.session.delete({ where: { id: sessionId } });
    console.log(
      `[Session Manager] Session with ID ${sessionId} invalidated successfully.`
    );
  } catch (error) {
    console.error(
      `[Session Manager] Failed to invalidate session with ID ${sessionId}:`,
      error
    );
    throw new Error("Could not invalidate session");
  }
}

// Invalidate all sessions for a user
export async function invalidateAllSessionsForUser(
  userId: number
): Promise<void> {
  console.log(`[Session Manager] Invalidating all sessions for user ${userId}`);

  try {
    const deletedSessions = await prisma.session.deleteMany({
      where: { userId },
    });
    console.log(
      `[Session Manager] Invalidated ${deletedSessions.count} sessions for user ${userId}.`
    );
  } catch (error) {
    console.error(
      `[Session Manager] Failed to invalidate sessions for user ${userId}:`,
      error
    );
    throw new Error("Could not invalidate sessions for the user");
  }
}

// Utility function to fetch all sessions for a user
export async function getSessionsForUser(userId: number): Promise<Session[]> {
  console.log(`[Session Manager] Fetching all sessions for user ${userId}`);

  try {
    const sessions = await prisma.session.findMany({
      where: { userId },
      include: { providerAccount: true },
    });
    console.log(
      `[Session Manager] Retrieved ${sessions.length} sessions for user ${userId}.`
    );
    return sessions;
  } catch (error) {
    console.error(
      `[Session Manager] Failed to fetch sessions for user ${userId}:`,
      error
    );
    throw new Error("Could not fetch sessions for the user");
  }
}

// Utility function to fetch all sessions for a provider account
export async function getSessionsForProviderAccount(
  providerAccountId: number
): Promise<Session[]> {
  console.log(
    `[Session Manager] Fetching all sessions for provider account ${providerAccountId}`
  );

  try {
    const sessions = await prisma.session.findMany({
      where: { providerAccountId },
      include: { user: true },
    });
    console.log(
      `[Session Manager] Retrieved ${sessions.length} sessions for provider account ${providerAccountId}.`
    );
    return sessions;
  } catch (error) {
    console.error(
      `[Session Manager] Failed to fetch sessions for provider account ${providerAccountId}:`,
      error
    );
    throw new Error("Could not fetch sessions for the provider account");
  }
}

export type SessionValidationResult =
  | {
      session: Session & { providerAccount: ProviderAccount };
      user: User;
      providerAccount: ProviderAccount;
    }
  | { session: null; user: null; providerAccount?: null };
