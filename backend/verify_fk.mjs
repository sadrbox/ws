import { prisma } from './prisma/prisma-client.js';

try {
  const fks = await prisma.$queryRawUnsafe(`
    SELECT conname::text, pg_get_constraintdef(oid)::text AS constraint_def
    FROM pg_constraint 
    WHERE conrelid = 'access_rights'::regclass 
      AND contype = 'f'
  `);
  console.log('access_rights FK constraints:', JSON.stringify(fks, null, 2));
} catch (e) {
  console.error('Error:', e.message);
}

await prisma.$disconnect();
