import { env } from "@/config";
import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { withPulse } from "@prisma/extension-pulse";

// Create a singleton instance
const prisma = new PrismaClient().$extends(withAccelerate()).$extends(
  withPulse({
    apiKey: env.PULSE_API_KEY,
  })
);

// Handle potential connection errors
prisma.$connect().catch((error) => {
  console.error("Failed to connect to database:", error);
  process.exit(1);
});

export { prisma };

export type Transaction = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
