// 清理 TOPIK 三本词书里的所有单词（用于修正映射错误后重新导入）
// 运行：在 server 目录执行 npx tsx scripts/clean-topik.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const topikBooks = await prisma.wordBook.findMany({ where: { category: 'topik' }, select: { id: true, name: true } });
  const del = await prisma.word.deleteMany({
    where: { bookId: { in: topikBooks.map((b) => b.id) } },
  });
  console.log(`✅ 已删除 TOPIK 词: ${del.count} 个（${topikBooks.map((b) => b.name).join('、')}）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
