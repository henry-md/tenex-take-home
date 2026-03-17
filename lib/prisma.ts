import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaAdapter?: PrismaPg;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const adapter =
  globalForPrisma.prismaAdapter ?? new PrismaPg({ connectionString });

function createPrismaClient() {
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function hasIntegrationDraftModel(client: PrismaClient | undefined) {
  return Boolean(client && "integrationActionDraft" in client);
}

const prismaClient =
  hasIntegrationDraftModel(globalForPrisma.prisma) && globalForPrisma.prisma
    ? globalForPrisma.prisma
    : createPrismaClient();

export const prisma: PrismaClient = prismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaAdapter = adapter;
  globalForPrisma.prisma = prisma;
}
