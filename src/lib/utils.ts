export function generateRandomString(length = 16): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export async function hashString(input: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Fixed sync version using Bun's native crypto
export function hashStringSync(input: string): string {
  const buffer = new TextEncoder().encode(input);
  const hash = Bun.hash(buffer);
  return hash.toString(16);
}
