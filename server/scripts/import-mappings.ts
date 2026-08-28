// 导入歌词/综艺映射（media/mappings.json → MediaMapping 表）
// 运行：在 server 目录执行 npx tsx scripts/import-mappings.ts
// 可重复运行：已存在的 (wordId, sourceName, startTime) 自动跳过
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

interface Mapping {
  wordId: string;
  hangul: string;
  sourceType: 'song' | 'going';
  sourceName: string;
  artist: string | null;
  quote: string;
  surface: string | null;
  startTime: number;
  endTime: number;
  audioUrl: string | null;
  quoteZh?: string | null; // 中文翻译（OCR/歌词导入后写回 mappings.json，重导时保留）
}

async function main() {
  const file = path.resolve(process.cwd(), '../media/mappings.json');
  if (!fs.existsSync(file)) {
    console.error('❌ 找不到 media/mappings.json，请先运行流水线脚本');
    process.exit(1);
  }
  const mappings: Mapping[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`📋 共 ${mappings.length} 条候选映射`);

  // mappings.json 里的 wordId 是本地库生成的 cuid：远程重建库后全部失效，按 hangul 回退重映射
  const allWords = await prisma.word.findMany({ select: { id: true, hangul: true } });
  const validIds = new Set(allWords.map((w) => w.id));
  const idByHangul = new Map<string, string>();
  for (const w of allWords) if (!idByHangul.has(w.hangul)) idByHangul.set(w.hangul, w.id);

  // 全量重导：先清空旧映射（保持与 mappings.json 一致）
  const removed = await prisma.mediaMapping.deleteMany({});
  console.log(`🧹 已清空旧映射 ${removed.count} 条`);

  let ok = 0;
  let failed = 0;
  for (const m of mappings) {
    const wordId = validIds.has(m.wordId) ? m.wordId : idByHangul.get(m.hangul);
    if (!wordId) {
      failed++;
      console.warn(`⚠️ 找不到词: ${m.hangul}（${m.sourceName}），已跳过`);
      continue;
    }
    try {
      await prisma.mediaMapping.create({
        data: {
          wordId,
          sourceType: m.sourceType,
          sourceName: m.sourceName,
          artist: m.artist,
          quote: m.quote,
          surface: m.surface,
          // JSON 里可能有浮点秒数（如 32.8），schema 是 Int，取整避免校验失败
          startTime: Math.round(m.startTime),
          endTime: Math.round(m.endTime),
          audioUrl: m.audioUrl,
          quoteZh: m.quoteZh ?? null,
          verified: false,
        },
      });
      ok++;
    } catch (e) {
      failed++;
    }
  }
  console.log(`✅ 导入完成: ${ok} 条${failed > 0 ? `，失败 ${failed} 条` : ''}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
