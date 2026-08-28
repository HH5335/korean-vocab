// 创建/设置管理员账号（isAdmin=true）
// 运行：在 server 目录执行 npx tsx scripts/create-admin.ts <用户名> <密码>
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth.js';

const prisma = new PrismaClient();

async function main() {
  const [, , username, password] = process.argv;
  if (!username || !password) {
    console.error('用法: npx tsx scripts/create-admin.ts <用户名> <密码>');
    process.exit(1);
  }
  if (!/^[\w一-龥]{1,20}$/.test(username)) {
    console.error('❌ 用户名需为 1-20 位中英文/数字/下划线');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('❌ 密码至少 6 位');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { isAdmin: true, passwordHash: hashPassword(password) },
    });
    console.log(`✅ 账号「${username}」已存在，已设为管理员并重置密码`);
  } else {
    await prisma.user.create({
      data: { username, passwordHash: hashPassword(password), isAdmin: true },
    });
    console.log(`✅ 已创建管理员账号「${username}」`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
