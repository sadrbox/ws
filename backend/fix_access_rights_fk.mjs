import { prisma } from './prisma/prisma-client.js';

try {
  // 1. Удаляем неправильный FK (userUuid -> employees)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE access_rights DROP CONSTRAINT IF EXISTS "access_rights_employeeUuid_fkey"
  `);
  console.log('✅ Dropped wrong FK: access_rights_employeeUuid_fkey (was pointing to employees)');

  // 2. Создаём правильный FK (userUuid -> users)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE access_rights 
    ADD CONSTRAINT "access_rights_userUuid_fkey" 
    FOREIGN KEY ("userUuid") REFERENCES users(uuid) 
    ON UPDATE CASCADE ON DELETE CASCADE
  `);
  console.log('✅ Created correct FK: access_rights_userUuid_fkey (userUuid -> users.uuid)');

  // 3. Проверяем результат
  const fks = await prisma.$queryRawUnsafe(`
    SELECT conname::text, pg_get_constraintdef(oid)::text AS constraint_def
    FROM pg_constraint 
    WHERE conrelid = 'access_rights'::regclass 
      AND contype = 'f'
  `);
  console.log('\nResult - access_rights FK constraints:', JSON.stringify(fks, null, 2));

} catch (e) {
  console.error('Error:', e.message);
}

await prisma.$disconnect();
