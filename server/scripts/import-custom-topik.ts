// 以用户的词表文件为准重建 TOPIK 初级/中级/中高级词书
// 数据源：data/custom/parsed.json（由 scripts/pipeline/parse_custom.py 生成）
// 运行：在 server 目录执行 npx tsx scripts/import-custom-topik.ts
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

interface Entry {
  hangul: string;
  meaningCn: string;
  pos: string | null;
  book: string;
  frequency: number;
  exampleKo?: string;
  exampleZh?: string;
}

async function main() {
  const file = path.resolve(process.cwd(), '../data/custom/parsed.json');
  if (!fs.existsSync(file)) {
    console.error('❌ 找不到 data/custom/parsed.json，请先运行 scripts/pipeline/parse_custom.py');
    process.exit(1);
  }
  const entries: Entry[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`📋 用户词表共 ${entries.length} 条`);

  const bookNames = ['TOPIK 初级词表', 'TOPIK 中级词表', 'TOPIK 中高级词表'];
  for (const bookName of bookNames) {
    const book = await prisma.wordBook.findFirst({ where: { name: bookName } });
    if (!book) {
      console.warn(`⚠️ 词书不存在: ${bookName}`);
      continue;
    }

    // ---------- 1. 旧词快照（按韩语词记录关联数据，用于导入后回挂） ----------
    const oldWords = await prisma.word.findMany({
      where: { bookId: book.id },
      select: { id: true, hangul: true },
    });
    const oldIds = oldWords.map((w) => w.id);
    const hangulById = new Map(oldWords.map((w) => [w.id, w.hangul]));

    // ---------- 2. 词书内去重（保留首个，即 1 级优先于 2 级） ----------
    const mine = entries.filter((e) => e.book === bookName);
    const seen = new Set<string>();
    const toCreate = mine.filter((e) => {
      if (seen.has(e.hangul)) return false;
      seen.add(e.hangul);
      return true;
    });

    // ---------- 3. 先建新词（旧词还在，回挂后再删旧词） ----------
    await prisma.word.createMany({
      data: toCreate.map((e) => ({
        hangul: e.hangul,
        meaningCn: e.meaningCn,
        partOfSpeech: e.pos,
        hanja: null,
        frequency: e.frequency,
        bookId: book.id,
        exampleKo: e.exampleKo || null,
        exampleZh: e.exampleZh || null,
        exampleSource: e.exampleKo ? 'book' : null,
      })),
    });

    // ---------- 4. 按韩语词把旧关联数据回挂到新词 ----------
    const oldIdSet = new Set(oldIds);
    const allBookWords = await prisma.word.findMany({
      where: { bookId: book.id },
      select: { id: true, hangul: true },
    });
    const newIdByHangul = new Map<string, string>();
    for (const w of allBookWords) {
      if (oldIdSet.has(w.id)) continue; // 只取新建的词（SQLite 参数上限，JS 端过滤）
      if (!newIdByHangul.has(w.hangul)) newIdByHangul.set(w.hangul, w.id);
    }

    // SQLite 每查询最多 999 个参数，oldIds 分批
    const chunk = <T,>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const relink = async (table: 'wordProgress' | 'errorWord' | 'mediaMapping', label: string) => {
      let kept = 0, dropped = 0;
      for (const ids of chunk(oldIds, 500)) {
        const rows = await (prisma as any)[table].findMany({ where: { wordId: { in: ids } } });
        for (const r of rows) {
          const hangul = hangulById.get(r.wordId);
          const newId = hangul ? newIdByHangul.get(hangul) : undefined;
          if (newId) {
            await (prisma as any)[table].update({ where: { id: r.id }, data: { wordId: newId } });
            kept++;
          } else {
            await (prisma as any)[table].delete({ where: { id: r.id } });
            dropped++;
          }
        }
      }
      if (kept || dropped) console.log(`   🔗 ${label}: 回挂 ${kept} 条，删除 ${dropped} 条`);
    };
    await relink('wordProgress', '学习进度');
    await relink('errorWord', '错词本');
    await relink('mediaMapping', '歌词映射');

    // 学习日志（无外键）→ 置空，保持与原逻辑一致
    await prisma.studyLog.updateMany({ where: { wordId: { in: oldIds } }, data: { wordId: null } });

    // ---------- 5. 删除旧词 ----------
    const delWord = await prisma.word.deleteMany({ where: { bookId: book.id, id: { in: oldIds } } });
    console.log(`🧹 ${bookName}: 删除旧词 ${delWord.count} 个`);

    console.log(`✅ ${bookName}: 导入 ${toCreate.length} 个词`);
  }

  console.log('\n🎉 完成！以你的文件为准的 TOPIK 词书已就位');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
