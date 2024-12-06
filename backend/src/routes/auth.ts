import { getCookie } from "hono/cookie";
import { type Context } from "hono";
import {
  createSession,
  generateSessionToken,
  validateSessionToken,
} from "@/lib/sessions";
import { deleteSessionCookie, setSessionCookie } from "@/lib/cookies";
import { prisma } from "@/lib/prisma";
import { googleAuth } from "@hono/oauth-providers/google";
import { env } from "@/config";
import { uploadToS3 } from "@/lib/upload";
import { generateRandomString, hashString } from "@/lib/utils";
import { h } from "@/lib/facotry";

export const authRoute = h.get("/me", getMe).get(
  "/google/callback",
  googleAuth({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    scope: ["openid", "email", "profile"],
  }),
  google
);

export async function getMe(c: Context): Promise<Response> {
  const sessionToken = getCookie(c, "session");

  if (!sessionToken) {
    console.error("[GetMe] No session token found in cookies");
    return c.json({ error: "Session token is missing" }, 401);
  }

  console.log("[GetMe] Received session token for validation", {
    sessionToken,
  });

  try {
    const { session, user } = await validateSessionToken(sessionToken);

    if (!session || !user) {
      console.warn("[GetMe] Invalid or expired session", { sessionToken });
      deleteSessionCookie(c);
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    setSessionCookie(c, sessionToken, session.expiresAt);

    console.log("[GetMe] Returning user details", { userId: user.id });

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
    console.error("[GetMe] Error while processing request", { error });
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
  const session = await createSession(
    sessionToken,
    user.id,
    providerAccount.id
  );

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
