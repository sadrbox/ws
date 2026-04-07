import { prisma } from "./prisma-client.js";

async function check() {
  try {
    // Проверяем столбцы users
    const userCols = await prisma.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position`
    );
    console.log("\n📋 users:");
    userCols.forEach(c => console.log(`   ${c.column_name} (${c.data_type}, nullable=${c.is_nullable})`));

    // Проверяем столбцы access_rights
    const arCols = await prisma.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'access_rights' ORDER BY ordinal_position`
    );
    console.log("\n📋 access_rights:");
    arCols.forEach(c => console.log(`   ${c.column_name} (${c.data_type}, nullable=${c.is_nullable})`));

    // Проверяем столбцы contact_persons
    const cpCols = await prisma.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'contact_persons' ORDER BY ordinal_position`
    );
    console.log("\n📋 contact_persons:");
    cpCols.forEach(c => console.log(`   ${c.column_name} (${c.data_type}, nullable=${c.is_nullable})`));

    // Проверяем все таблицы
    const tables = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    console.log("\n📋 All tables:", tables.map(t => t.table_name).join(", "));

  } catch (e) {
    console.error("❌ Error:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
