import { getCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import { createSession, generateSessionToken } from "@/lib/sessions";
import { deleteSessionCookie, setSessionCookie } from "@/lib/cookies";
import { prisma } from "@/lib/prisma";
import { googleAuth } from "@hono/oauth-providers/google";
import { env } from "@/config";
import { uploadToS3 } from "@/lib/upload";
import { generateRandomString, hashString } from "@/lib/utils";
import { createHash } from "crypto";
import { AuthenticationType, Role } from "@prisma/client";

export const authRoute = new Hono()
  .get("/me", getMe)
  .get(
    "/google/callback",
    googleAuth({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      scope: ["openid", "email", "profile"],
    }),
    google
  )
  .post("/credentials/signup", signupWithCredentials)
  .post("/credentials/login", loginWithCredentials);

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

async function signupWithCredentials(c: Context): Promise<Response> {
  try {
    const { email, password, name } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    // Check if email exists in credentials or OAuth providers
    const existingCredentials = await prisma.credentialsProvider.findUnique({
      where: { email },
    });

    const existingOAuth = await prisma.providerAccount.findFirst({
      where: { email },
    });

    if (existingCredentials || existingOAuth) {
      return c.json({ error: "Email already in use" }, 400);
    }

    const passwordHash = hashPassword(password);

    // Create user and credentials in a transaction
    const { user, credentials } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: name || email,
          roles: [Role.STUDENT],
        },
      });

      const credentials = await tx.credentialsProvider.create({
        data: {
          userId: user.id,
          email,
          passwordHash,
        },
      });

      return { user, credentials };
    });

    // Create session
    const sessionToken = generateSessionToken();
    const session = await createSession({
      token: sessionToken,
      userId: credentials.userId,
      authType: AuthenticationType.CREDENTIALS,
      credentialsId: credentials.id,
    });

    setSessionCookie(c, sessionToken, session.expiresAt);

    return c.json({
      user: {
        id: user.id,
        name: user.name,
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    console.error("[Credentials Signup] Error:", error);
    return c.json({ error: "An error occurred during signup" }, 500);
  }
}

async function loginWithCredentials(c: Context): Promise<Response> {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const credentials = await prisma.credentialsProvider.findUnique({
      where: { email },
      include: {
        user: true,
      },
    });

    if (!credentials) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    // Check account lock
    if (credentials.lockedUntil && credentials.lockedUntil > new Date()) {
      return c.json(
        {
          error: "Account is temporarily locked. Please try again later",
        },
        401
      );
    }

    const passwordHash = hashPassword(password);
    if (credentials.passwordHash !== passwordHash) {
      // Update failed attempts
      await prisma.credentialsProvider.update({
        where: { id: credentials.id },
        data: {
          failedAttempts: { increment: 1 },
          lastFailedAt: new Date(),
          lockedUntil:
            credentials.failedAttempts >= 4
              ? new Date(Date.now() + 15 * 60 * 1000)
              : null,
        },
      });

      return c.json({ error: "Invalid email or password" }, 401);
    }

    // Reset failed attempts
    await prisma.credentialsProvider.update({
      where: { id: credentials.id },
      data: {
        failedAttempts: 0,
        lastFailedAt: null,
        lockedUntil: null,
      },
    });

    // Create session
    const sessionToken = generateSessionToken();
    const session = await createSession({
      token: sessionToken,
      userId: credentials.userId,
      authType: AuthenticationType.CREDENTIALS,
      credentialsId: credentials.id,
    });

    setSessionCookie(c, sessionToken, session.expiresAt);

    return c.json({
      user: {
        id: credentials.user.id,
        name: credentials.user.name,
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    console.error("[Credentials Login] Error:", error);
    return c.json({ error: "An error occurred during login" }, 500);
  }
}

// Updated getMe to handle both OAuth and Credentials sessions
export async function getMe(c: Context): Promise<Response> {
  const sessionToken = getCookie(c, "session");

  if (!sessionToken) {
    console.error("[GetMe] No session token found in cookies");
    return c.json({ error: "Session token is missing" }, 401);
  }

  const sessionId = createHash("sha256").update(sessionToken).digest("hex");
  console.log("[GetMe] Validating session:", { sessionId });

  try {
    const sessionRecord = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
        providerAccount: true,
        credentials: true,
      },
    });

    if (!sessionRecord || !sessionRecord.user) {
      console.warn("[GetMe] Invalid or expired session");
      deleteSessionCookie(c);
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    // Handle session expiration
    if (Date.now() >= sessionRecord.expiresAt.getTime()) {
      await prisma.session.delete({ where: { id: sessionId } });
      deleteSessionCookie(c);
      return c.json({ error: "Session expired" }, 401);
    }

    // Extend session if needed
    if (
      Date.now() >=
      sessionRecord.expiresAt.getTime() - 15 * 24 * 60 * 60 * 1000
    ) {
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await prisma.session.update({
        where: { id: sessionId },
        data: { expiresAt: newExpiresAt },
      });
      setSessionCookie(c, sessionToken, newExpiresAt);
    }

    // Return user info with auth type
    return c.json({
      user: {
        id: sessionRecord.user.id,
        name: sessionRecord.user.name,
      },
      authType: sessionRecord.providerAccount
        ? AuthenticationType.OAUTH
        : AuthenticationType.CREDENTIALS,
      session: {
        id: sessionRecord.id,
        expiresAt: sessionRecord.expiresAt,
      },
    });
  } catch (error) {
    console.error("[GetMe] Error:", error);
    return c.json({ error: "An error occurred while retrieving profile" }, 500);
  }
}

async function handleProfilePicture(
  pictureUrl: string,
  providerAccountId: string
): Promise<string | null> {
  try {
    // Fetch the image from the provided URL
    const response = await fetch(pictureUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch image from ${pictureUrl}: ${response.statusText}`
      );
    }

    // Validate the content type
    const contentType = response.headers.get("Content-Type");
    if (!contentType || !contentType.startsWith("image")) {
      throw new Error(`Invalid content type for image: ${contentType}`);
    }

    // Read the image as an ArrayBuffer
    const buffer = await response.arrayBuffer();

    // Extract file extension from the MIME type (e.g., "image/jpeg" -> "jpeg")
    const extension = contentType.split("/")[1];

    // Generate a unique file name for the S3 object
    const fileName = `profile-pictures/${providerAccountId}-${generateRandomString()}.${extension}`;

    console.log(
      `[Profile Picture] Uploading image to S3 with filename: ${fileName}`
    );

    // Upload the image to S3 and get the URL
    const uploadedImageUrl = await uploadToS3(
      fileName,
      Buffer.from(buffer),
      contentType
    );

    console.log(
      `[Profile Picture] Image uploaded successfully to ${uploadedImageUrl}`
    );

    return uploadedImageUrl;
  } catch (error) {
    console.error(`[Profile Picture] Error handling profile picture:`, error);
    return null; // Return null if the image upload fails
  }
}

export async function google(c: Context): Promise<Response> {
  const token = c.get("token");
  const userGoogle = c.get("user-google");

  if (!token || !userGoogle) {
    console.error("[Auth Callback] Invalid token or user.");
    return c.json({ error: "Invalid token or user" }, 400);
  }

  const { email, id: providerAccountId, picture, name } = userGoogle;

  if (!providerAccountId || !email) {
    console.error(
      "[Auth Callback] Missing required fields (providerAccountId, email)."
    );
    return c.json({ error: "Provider account ID and email are required" }, 400);
  }

  const provider = "google";

  let user = await prisma.user.findFirst({
    where: {
      accounts: {
        some: { provider, oauthProviderId: providerAccountId },
      },
    },
    include: {
      accounts: { where: { provider, oauthProviderId: providerAccountId } },
    },
  });

  let providerAccount = user?.accounts[0] || null;
  let uploadedImageUrl: string | null = null;

  if (!user) {
    console.log("[Auth Callback] Creating new user and provider account.");

    // Upload profile picture for new user
    if (picture) {
      try {
        uploadedImageUrl = await handleProfilePicture(
          picture,
          providerAccountId
        );
      } catch (error) {
        console.error("[Auth Callback] Failed to upload the image:", error);
      }
    }

    user = await prisma.user.create({
      data: {
        image: uploadedImageUrl,
        name: name || email,
        accounts: {
          create: {
            provider,
            oauthProviderId: providerAccountId,
            email,
            imageUrl: picture || null,
            accessToken: token.token,
            refreshToken: null,
            expiresAt: token.expires_in
              ? new Date(Date.now() + token.expires_in * 1000)
              : null,
          },
        },
      },
      include: {
        accounts: { where: { provider, oauthProviderId: providerAccountId } },
      },
    });

    providerAccount = user.accounts[0];
  } else {
    console.log("[Auth Callback] Updating existing provider account and user.");

    // Check if profile picture has changed
    if (picture) {
      const newPictureHash = hashString(picture);
      const existingPictureHash = providerAccount?.imageUrl
        ? hashString(providerAccount.imageUrl)
        : null;

      if (newPictureHash !== existingPictureHash) {
        console.log("[Auth Callback] Profile picture has changed. Updating...");
        try {
          uploadedImageUrl = await handleProfilePicture(
            picture,
            providerAccountId
          );
        } catch (error) {
          console.error("[Auth Callback] Failed to upload the image:", error);
        }
      } else {
        console.log("[Auth Callback] Profile picture is unchanged.");
        uploadedImageUrl = user.image; // Keep the existing image
      }
    }

    // Update provider account
    providerAccount = await prisma.providerAccount.update({
      where: {
        provider_oauthProviderId: {
          provider,
          oauthProviderId: providerAccountId,
        },
      },
      data: {
        email,
        imageUrl: picture,
        accessToken: token.token,
        expiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
      },
    });

    // Update user image only if it has changed
    if (uploadedImageUrl !== user.image) {
      await prisma.user.update({
        where: { id: user.id },
        data: { image: uploadedImageUrl },
      });
    }
  }

  // Create session and set cookie
  const sessionToken = generateSessionToken();
  const session = await createSession({
    token: sessionToken,
    userId: user.id,
    authType: AuthenticationType.OAUTH,
    providerAccountId: providerAccount.id,
  });

  console.log(
    `[Auth Callback] Session created successfully for user ${user.id} with session token ${sessionToken}`
  );

  setSessionCookie(c, sessionToken, session.expiresAt);

  return c.json({
    token: sessionToken,
    user: {
      id: user.id,
      name: user.name,
      image: uploadedImageUrl,
    },
    providerAccount: {
      id: providerAccount.id,
      provider: providerAccount.provider,
      oauthProviderId: providerAccount.oauthProviderId,
    },
    session: {
      id: session.id,
      expiresAt: session.expiresAt,
    },
  });
}
