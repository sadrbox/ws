import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// ── Прямой pg Pool для запросов, где Prisma ORM падает ──────────────────
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	statement_timeout: 0,
	query_timeout: 0,
});

// ── Prisma Client с driver adapter ─────────────────────────────────────
// ВАЖНО: если Prisma падает с "The column (not available) does not exist",
// нужно запустить: npx prisma db pull && npx prisma generate
const adapter = new PrismaPg(pool, {
	schema: "public",
});

const prisma = new PrismaClient({ adapter });

export { prisma, pool };
