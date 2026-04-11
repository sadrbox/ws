import { prisma } from "./prisma-client.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function main() {
  console.log("🔧 Creating admin user...");

  const hashedPassword = await bcrypt.hash("admin", 12);
  const newUuid = crypto.randomUUID();

  // Проверяем есть ли уже admin
  const existing = await prisma.user.findFirst({
    where: { username: { equals: "admin", mode: "insensitive" } },
  });

  if (existing) {
    console.log(`✅ Admin user already exists (id=${existing.id}, uuid=${existing.uuid})`);
    await prisma.user.update({
      where: { id: existing.id },
      data: { isSuperAdmin: true, password: hashedPassword },
    });
    console.log("   → Updated: isSuperAdmin = true, password = 'admin'");
  } else {
    const user = await prisma.user.create({
      data: {
        uuid: newUuid,
        username: "admin",
        password: hashedPassword,
        isSuperAdmin: true,
      },
    });
    console.log(`✅ Created admin user (id=${user.id}, uuid=${user.uuid})`);
    console.log("   → username: admin");
    console.log("   → password: admin");
    console.log("   → isSuperAdmin: true");
  }
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
