import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

function createPrismaClient(): PrismaClient {
  // In production, DATABASE_URL is set by the Tauri launcher pointing to the app data dir.
  // In development, fall back to dev.db in the project root.
  const dbUrl = process.env.DATABASE_URL || `file:${path.resolve(process.cwd(), "dev.db")}`;
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
