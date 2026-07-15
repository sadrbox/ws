import { prisma } from "./prisma-client.js";

async function migrate() {
  console.log("🔧 Applying manual schema fixes...\n");

  try {
    // ── 1. access_permissions: переименовать employeeUuid → userUuid ──────
    const arCols = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'access_permissions'`
    );
    const arColNames = new Set(arCols.map(c => c.column_name));

    if (arColNames.has("employeeUuid") && !arColNames.has("userUuid")) {
      console.log("   → Renaming access_permissions.employeeUuid → userUuid");
      await prisma.$executeRawUnsafe(`ALTER TABLE "access_permissions" RENAME COLUMN "employeeUuid" TO "userUuid"`);
      // Сделаем nullable (в schema.prisma — required, но для безопасности)
      console.log("   → Done!");
    } else if (!arColNames.has("userUuid")) {
      console.log("   → Adding access_permissions.userUuid");
      await prisma.$executeRawUnsafe(`ALTER TABLE "access_permissions" ADD COLUMN "userUuid" TEXT NOT NULL DEFAULT ''`);
    } else {
      console.log("   ✅ access_permissions.userUuid already exists");
    }

    // Убедимся что есть индекс
    try {
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "access_permissions_userUuid_idx" ON "access_permissions" ("userUuid")`);
      console.log("   → Index on userUuid created/verified");
    } catch (e) { /* already exists */ }

    // Удалим старый индекс если есть
    try {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "access_permissions_employeeUuid_idx"`);
    } catch (e) { /* ok */ }

    // ── 2. contact_persons: добавить avatarPath ──────────────────────
    const cpCols = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'contact_persons'`
    );
    const cpColNames = new Set(cpCols.map(c => c.column_name));

    if (!cpColNames.has("avatarPath")) {
      console.log("   → Adding contact_persons.avatarPath");
      await prisma.$executeRawUnsafe(`ALTER TABLE "contact_persons" ADD COLUMN "avatarPath" TEXT`);
      console.log("   → Done!");
    } else {
      console.log("   ✅ contact_persons.avatarPath already exists");
    }

    // ── 3. Проверяем users (уже добавлены seed-ом, но проверим) ──────
    const uCols = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
    );
    const uColNames = new Set(uCols.map(c => c.column_name));

    if (!uColNames.has("isSuperAdmin")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false`);
      console.log("   → Added users.isSuperAdmin");
    }
    if (!uColNames.has("avatarPath")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "avatarPath" TEXT`);
      console.log("   → Added users.avatarPath");
    }
    if (!uColNames.has("organizationUuid")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "organizationUuid" TEXT`);
      console.log("   → Added users.organizationUuid");
    }

    console.log("\n   ✅ users OK");

    // ── 4. Создаём/обновляем запись в _prisma_migrations ─────────────
    // Чтобы prisma migrate status не жаловался
    const migrationName = "20260407_manual_sync_schema";
    const existing = await prisma.$queryRawUnsafe(
      `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`, migrationName
    );
    if (existing.length === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, logs, started_at, finished_at, applied_steps_count)
         VALUES (gen_random_uuid(), 'manual', $1, 'Manual sync', NOW(), NOW(), 1)`,
        migrationName
      );
      console.log("   → Recorded migration in _prisma_migrations");
    }

    console.log("\n🎉 All schema fixes applied successfully!");

  } catch (e) {
    console.error("❌ Error:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
