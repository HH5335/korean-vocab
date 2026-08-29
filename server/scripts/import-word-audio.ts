// 把 data/word-audio-manifest.json 里的单词原声路径写入 Word.audioUrl（可重复运行）
// 运行：在 server 目录执行 npx tsx scripts/import-word-audio.ts
// 前置：scripts/pipeline/gen_word_audio.py 已生成 media/word-audio/*.mp3 + manifest
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const file = path.resolve(process.cwd(), '../data/word-audio-manifest.json');
  if (!fs.existsSync(file)) {
    console.error('❌ 找不到 data/word-audio-manifest.json，请先运行 scripts/pipeline/gen_word_audio.py');
    process.exit(1);
  }
  const manifest: Record<string, string> = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Object.entries(manifest);
  console.log(`📋 manifest 共 ${entries.length} 词，按 hangul 写入 Word.audioUrl …`);

  let ok = 0;
  let miss = 0;
  // 同一 hangul 在多个词书里可能有多行 Word，按 hangul 整体更新，保证全覆盖
  const hanguls = entries.map(([h]) => h);
  const existing = new Set(
    (await prisma.word.findMany({ where: { hangul: { in: hanguls } }, select: { hangul: true } })).map((w) => w.hangul),
  );
  for (const [hangul, url] of entries) {
    if (!existing.has(hangul)) {
      miss++;
      continue;
    }
    const r = await prisma.word.updateMany({ where: { hangul }, data: { audioUrl: url } });
    ok += r.count;
  }
  console.log(`✅ 完成：写入 ${ok} 行${miss > 0 ? `，词表未匹配 ${miss} 词` : ''}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
