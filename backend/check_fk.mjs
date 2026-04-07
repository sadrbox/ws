import { prisma } from './prisma/prisma-client.js';

try {
  // Проверяем FK constraints на access_rights
  const fks = await prisma.$queryRawUnsafe(`
    SELECT conname::text, pg_get_constraintdef(oid)::text AS constraint_def
    FROM pg_constraint 
    WHERE conrelid = 'access_rights'::regclass 
      AND contype = 'f'
  `);
  console.log('access_rights FK constraints:', JSON.stringify(fks, null, 2));

  // Проверяем столбцы access_rights
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns 
    WHERE table_name = 'access_rights' ORDER BY ordinal_position
  `);
  console.log('\naccess_rights columns:', JSON.stringify(cols, null, 2));

  // Проверяем FK constraints на employee_history
  const fks2 = await prisma.$queryRawUnsafe(`
    SELECT conname::text, pg_get_constraintdef(oid)::text AS constraint_def
    FROM pg_constraint 
    WHERE conrelid = 'employee_history'::regclass 
      AND contype = 'f'
  `);
  console.log('\nemployee_history FK constraints:', JSON.stringify(fks2, null, 2));

  // Проверяем столбцы employee_history
  const cols2 = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns 
    WHERE table_name = 'employee_history' ORDER BY ordinal_position
  `);
  console.log('\nemployee_history columns:', JSON.stringify(cols2, null, 2));

} catch (e) {
  console.error('Error:', e.message);
}

await prisma.$disconnect();
