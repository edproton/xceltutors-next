import { AuthError } from "@/errors/auth.error";
import { prisma } from "@/lib/prisma";
import { createSession, generateSessionToken } from "@/lib/sessions";
import { AuthenticationType } from "@prisma/client";
import { LoginWithCredentialsInput, LoginWithCredentialsOutput } from "./types";
import { hashPassword } from "../shared/auth/auth";

export class LoginWithCredentialsCommand {
  static async execute(
    input: LoginWithCredentialsInput,
  ): Promise<LoginWithCredentialsOutput> {
    const { email, password } = input;

    // Find user credentials
    const credentials = await prisma.credentialsProvider.findUnique({
      where: { email },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    if (!credentials) {
      throw new AuthError("Invalid email or password");
    }

    // Check account lock
    await this.validateAccountLock(credentials);

    // Validate password
    const isValidPassword = await this.validatePassword(credentials, password);
    if (!isValidPassword) {
      await this.handleFailedAttempt(credentials);
      throw new AuthError("Invalid email or password");
    }

    // Reset failed attempts and create session
    await this.resetFailedAttempts(credentials.id);
    const session = await this.createNewSession(credentials);

    return {
      user: {
        id: credentials.user.id,
        name: credentials.user.name,
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
    };
  }

  private static async validateAccountLock(credentials: {
    lockedUntil: Date | null;
  }) {
    if (credentials.lockedUntil && credentials.lockedUntil > new Date()) {
      throw new AuthError(
        "Account is temporarily locked. Please try again later",
      );
    }
  }

  private static async validatePassword(
    credentials: { passwordHash: string },
    password: string,
  ): Promise<boolean> {
    const passwordHash = hashPassword(password);
    return credentials.passwordHash === passwordHash;
  }

  private static async handleFailedAttempt(credentials: {
    id: number;
    failedAttempts: number;
  }) {
    await prisma.credentialsProvider.update({
      where: { id: credentials.id },
      data: {
        failedAttempts: { increment: 1 },
        lastFailedAt: new Date(),
        lockedUntil: credentials.failedAttempts >= 4
          ? new Date(Date.now() + 15 * 60 * 1000)
          : null,
      },
    });
  }

  private static async resetFailedAttempts(credentialsId: number) {
    await prisma.credentialsProvider.update({
      where: { id: credentialsId },
      data: {
        failedAttempts: 0,
        lastFailedAt: null,
        lockedUntil: null,
      },
    });
  }

  private static async createNewSession(credentials: {
    userId: number;
    id: number;
  }) {
    const sessionToken = generateSessionToken();
    return createSession({
      token: sessionToken,
      userId: credentials.userId,
      authType: AuthenticationType.CREDENTIALS,
      credentialsId: credentials.id,
    });
  }
}
