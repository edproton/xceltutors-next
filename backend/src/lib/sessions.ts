import { prisma } from "./prisma";
import {
  encodeBase32LowerCaseNoPadding,
  encodeHexLowerCase,
} from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { Session, AuthenticationType, Prisma } from "@prisma/client";

// Time constants (in days)
const SESSION_DURATION_DAYS = 30;
const SESSION_EXTENSION_THRESHOLD_DAYS = 15;

// Convert days to milliseconds (internal helper)
const daysToMs = (days: number) => days * 24 * 60 * 60 * 1000;

export function generateSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = encodeBase32LowerCaseNoPadding(bytes);

  return token;
}

type CreateSessionParams = {
  token: string;
  userId: number;
  authType: AuthenticationType;
} & (
  | { providerAccountId: number; credentialsId?: never }
  | { credentialsId: number; providerAccountId?: never }
);

export async function createSession({
  token,
  userId,
  authType,
  providerAccountId,
  credentialsId,
}: CreateSessionParams): Promise<Session> {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  const expiresAt = new Date(Date.now() + daysToMs(SESSION_DURATION_DAYS));

  const sessionData: Prisma.SessionCreateInput = {
    id: sessionId,
    expiresAt,
    authenticationType: authType,
    user: { connect: { id: userId } },
    ...(authType === AuthenticationType.OAUTH
      ? { providerAccount: { connect: { id: providerAccountId! } } }
      : { credentials: { connect: { id: credentialsId! } } }),
  };

  try {
    const createdSession = await prisma.session.create({
      data: sessionData,
    });

    return createdSession;
  } catch (error) {
    console.error(
      `[Session Manager] Failed to create session for user ${userId}:`,
      error
    );

    throw new Error("Could not create session");
  }
}

export type SessionWithUser = Prisma.SessionGetPayload<{
  include: { user: true };
}>;

export async function validateSessionToken(
  token: string
): Promise<SessionWithUser | undefined> {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));

  try {
    const sessionRecord = await prisma.session.findUnique({
      where: { id: token },
      include: {
        user: true,
      },
    });

    if (!sessionRecord) {
      console.warn(`[Session Manager] Session with ID ${sessionId} not found.`);
      return undefined;
    }

    if (Date.now() >= sessionRecord.expiresAt.getTime()) {
      console.warn(
        `[Session Manager] Session with ID ${sessionId} has expired. Deleting session.`
      );
      await prisma.session.delete({ where: { id: sessionId } });

      return undefined;
    }

    // Handle session extension
    if (
      Date.now() >=
      sessionRecord.expiresAt.getTime() -
        daysToMs(SESSION_EXTENSION_THRESHOLD_DAYS)
    ) {
      sessionRecord.expiresAt = new Date(
        Date.now() + daysToMs(SESSION_DURATION_DAYS)
      );
      await prisma.session.update({
        where: { id: sessionId },
        data: { expiresAt: sessionRecord.expiresAt },
      });
    }

    return sessionRecord;
  } catch (error) {
    console.error(
      `[Session Manager] Error validating session with ID ${sessionId}:`,
      error
    );

    throw new Error("Could not validate session");
  }
}
