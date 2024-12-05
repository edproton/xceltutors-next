import { PrismaClient } from "@prisma/client";

// Create a singleton instance
const prisma = new PrismaClient();

// Handle potential connection errors
prisma.$connect().catch((error) => {
  console.error("Failed to connect to database:", error);
  process.exit(1);
});

export { prisma };
