import { createHash } from "crypto";

export function generateRandomString(length = 16): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
