import { prisma } from "./prisma-client.js";

async function check() {
  try {
    // 1. Raw SQL — работает ли вообще?
    console.log("1️⃣ Raw SQL test:");
    const raw = await prisma.$queryRawUnsafe(`SELECT id, uuid, username FROM users WHERE LOWER(username) = 'admin' LIMIT 1`);
    console.log("   Raw result:", JSON.stringify(raw));

    // 2. Prisma ORM — простой findFirst без include
    console.log("\n2️⃣ Prisma findFirst (no include):");
    const user1 = await prisma.user.findFirst({
      where: { username: "admin" },
      select: { id: true, uuid: true, username: true },
    });
    console.log("   Result:", JSON.stringify(user1));

    // 3. Prisma ORM — с include employee
    console.log("\n3️⃣ Prisma findFirst (include employee):");
    const user2 = await prisma.user.findFirst({
      where: { username: { equals: "admin", mode: "insensitive" } },
      include: { employee: { include: { organization: true } } },
    });
    console.log("   Result:", JSON.stringify(user2 ? { id: user2.id, username: user2.username, employee: user2.employee } : null));

  } catch (e) {
    console.error("❌ Error:", e.message);
    console.error("   Code:", e.code);
    if (e.meta) console.error("   Meta:", JSON.stringify(e.meta));
  } finally {
    await prisma.$disconnect();
  }
}

check();
