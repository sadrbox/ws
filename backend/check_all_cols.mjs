import { prisma } from './prisma/prisma-client.js';

const tables = ['organizations', 'users', 'employees', 'access_rights', 'activity_history', 'contacts', 'contact_persons'];

for (const table of tables) {
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`
  );
  const colNames = cols.map(c => c.column_name);
  console.log(`\n${table}: ${colNames.join(', ')}`);
}

// Также проверим ВСЕ таблицы в public schema
const allTables = await prisma.$queryRawUnsafe(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
);
console.log('\nAll tables:', allTables.map(t => t.table_name).join(', '));

await prisma.$disconnect();
