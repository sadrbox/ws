import { prisma } from './prisma/prisma-client.js';
const cols = await prisma.$queryRawUnsafe("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'employees' ORDER BY ordinal_position");
console.log('employees columns:', JSON.stringify(cols, null, 2));
await prisma.$disconnect();
