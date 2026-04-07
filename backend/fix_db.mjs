import { prisma } from './prisma/prisma-client.js';

try {
  // Добавляем недостающий столбец inviteCode в organizations
  await prisma.$executeRawUnsafe(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "inviteCode" TEXT UNIQUE`);
  console.log('✅ inviteCode column added to organizations');

  // Проверяем результат
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations' ORDER BY ordinal_position`
  );
  console.log('organizations columns:', cols.map(c => c.column_name).join(', '));
} catch (e) {
  console.error('Error:', e.message);
}

await prisma.$disconnect();
