import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { dbPoolConfig } from "../utils/dbPoolConfig.js";

// ── Прямой pg Pool для запросов, где Prisma ORM падает ──────────────────
// Предел пула, ожидание соединения и предел запроса — явные (Н2 аудита 26.09): см.
// utils/dbPoolConfig.js и переменные DB_POOL_MAX / DB_POOL_CONNECTION_TIMEOUT_MS /
// DB_STATEMENT_TIMEOUT_MS в .env.example.
const pool = new Pool(dbPoolConfig());

// ── Prisma Client с driver adapter ─────────────────────────────────────
// ВАЖНО: если Prisma падает с "The column (not available) does not exist",
// нужно запустить: npx prisma db pull && npx prisma generate
const adapter = new PrismaPg(pool, {
	schema: "public",
});

// Секреты пользователя скрыты ПО УМОЛЧАНИЮ (вторая линия защиты, аудит 26.09): любой запрос
// без явного select (include автора, куратора, исполнителя…) не вытащит хэш пароля и секрет 2FA.
// Где они нужны (вход, смена пароля, 2FA, признак «пароль задан» в списке пользователей),
// их берут явно: select: { password: true } / { twoFactorSecret: true }.
const prisma = new PrismaClient({
	adapter,
	omit: { user: { password: true, twoFactorSecret: true } },
});

export { prisma, pool };
