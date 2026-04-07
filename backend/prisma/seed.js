import { prisma } from "./prisma-client.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function main() {
  console.log("🌱 Seeding database...");

  // Проверим наличие столбцов isSuperAdmin, avatarPath, organizationUuid
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
  );
  const colNames = new Set(cols.map(c => c.column_name));

  // Добавляем недостающие столбцы
  if (!colNames.has("isSuperAdmin")) {
    console.log("   → Adding column isSuperAdmin...");
    await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false`);
  }
  if (!colNames.has("avatarPath")) {
    console.log("   → Adding column avatarPath...");
    await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN "avatarPath" TEXT`);
  }
  if (!colNames.has("organizationUuid")) {
    console.log("   → Adding column organizationUuid...");
    await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN "organizationUuid" TEXT`);
  }

  const hashedPassword = await bcrypt.hash("admin", 12);
  const newUuid = crypto.randomUUID();

  const existing = await prisma.$queryRawUnsafe(
    `SELECT id, uuid FROM users WHERE LOWER(username) = 'admin' LIMIT 1`
  );

  if (existing.length > 0) {
    const row = existing[0];
    console.log(`✅ Admin user already exists (id=${row.id}, uuid=${row.uuid})`);
    await prisma.$executeRawUnsafe(
      `UPDATE users SET "isSuperAdmin" = true, password = $1 WHERE uuid = $2`,
      hashedPassword, row.uuid
    );
    console.log("   → Updated isSuperAdmin = true, password reset to 'admin'");
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (uuid, username, password, "isSuperAdmin") VALUES ($1, $2, $3, true)`,
      newUuid, "admin", hashedPassword
    );
    console.log(`✅ Created admin user (uuid=${newUuid})`);
  }

  console.log("🌱 Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
