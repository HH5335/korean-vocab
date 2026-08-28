// 导入 PDF 书词表到数据库：data/pdf-books/extracted/*.csv → 新 WordBook + Word（含文本例句）
// 运行：在 server 目录执行 npx tsx scripts/import-pdf-books.ts
// 可重复运行：已存在的 (词书, 韩语词) 会更新释义/词性/例句（订正后重跑即可）
// 例句规则：该 hangul 已有视频映射（MediaMapping）→ 不写例句字段；否则书例句优先，其次 ai-examples.json
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const DATA_DIR = path.resolve(process.cwd(), '../data');
const EXTRACTED_DIR = path.join(DATA_DIR, 'pdf-books', 'extracted');

// ---------- 简易 CSV 解析（与 import-words.ts 相同实现） ----------
function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

interface BookMeta { name: string; level: string }

async function main() {
  // ---------- 1. 按书配置（可选） ----------
  let metaMap: Record<string, BookMeta> = {};
  const configPath = path.join(DATA_DIR, 'pdf-books', 'config.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^﻿/, ''); // 去 BOM
    const cfg = JSON.parse(raw);
    metaMap = {
      ...(cfg.books ?? {}),
    };
  }

  // ---------- 2. 已存在单词的去重集合 + 视频例句词集合 ----------
  const existingWords = await prisma.word.findMany({ select: { bookId: true, hangul: true } });
  const seen = new Set(existingWords.map((w) => `${w.bookId}|${w.hangul}`));
  // 该 hangul 全局已有视频映射 → 不写文本例句（与 Excel 合并规则一致）
  const videoMappings = await prisma.mediaMapping.findMany({
    distinct: ['wordId'],
    include: { word: { select: { hangul: true } } },
  });
  const hangulWithVideo = new Set(videoMappings.map((m) => m.word.hangul));

  // ---------- 3. AI 例句 ----------
  let aiExamples: Record<string, { ko: string; zh?: string }> = {};
  const aiPath = path.join(EXTRACTED_DIR, 'ai-examples.json');
  if (fs.existsSync(aiPath)) {
    aiExamples = JSON.parse(fs.readFileSync(aiPath, 'utf8'));
  }

  // ---------- 4. 逐本导入 ----------
  const csvFiles = fs.readdirSync(EXTRACTED_DIR).filter((f) => f.endsWith('.csv')).sort();
  let totalCreated = 0;
  let totalUpdated = 0;

  for (const file of csvFiles) {
    const slug = path.basename(file, '.csv');
    const meta = metaMap[slug] ?? {};
    const bookName = meta.name || slug;
    const level = meta.level || 'beginner';

    let book = await prisma.wordBook.findFirst({ where: { name: bookName } });
    if (!book) {
      book = await prisma.wordBook.create({
        data: { name: bookName, category: 'textbook', level },
      });
    }

    const rows = parseCSV(fs.readFileSync(path.join(EXTRACTED_DIR, file), 'utf8'));
    const header = rows[0];
    const idx = {
      hangul: header.indexOf('hangul'), pos: header.indexOf('pos'),
      meaning: header.indexOf('meaning_cn'), exKo: header.indexOf('example_ko'),
      exZh: header.indexOf('example_zh'), status: header.indexOf('status'),
    };

    const toCreate: Array<{
      hangul: string; meaningCn: string; partOfSpeech: string | null; hanja: string | null;
      frequency: number; bookId: string; exampleKo: string | null; exampleZh: string | null;
      exampleSource: string | null;
    }> = [];
    let created = 0;
    let updated = 0;

    for (const r of rows.slice(1)) {
      if (!r || r.length <= idx.hangul) continue;
      const hangul = r[idx.hangul].trim();
      if (!hangul) continue;
      if ((r[idx.status] ?? '').trim().toLowerCase() === 'delete') continue;
      const meaning = (r[idx.meaning] ?? '').trim();
      const pos = (r[idx.pos] ?? '').trim();
      const bookExKo = (r[idx.exKo] ?? '').trim();
      const bookExZh = (r[idx.exZh] ?? '').trim();

      // 例句：视频词不写；书例句优先；否则 AI
      let exampleKo: string | null = null;
      let exampleZh: string | null = null;
      let exampleSource: string | null = null;
      if (!hangulWithVideo.has(hangul)) {
        if (bookExKo) {
          exampleKo = bookExKo;
          exampleZh = bookExZh || null;
          exampleSource = 'book';
        } else if (aiExamples[hangul]) {
          exampleKo = aiExamples[hangul].ko;
          exampleZh = aiExamples[hangul].zh ?? null;
          exampleSource = 'ai';
        }
      }

      const key = `${book.id}|${hangul}`;
      if (seen.has(key)) {
        // 已存在 → 更新（订正后重跑生效）
        await prisma.word.updateMany({
          where: { bookId: book.id, hangul },
          data: {
            meaningCn: meaning || '(待补充释义)',
            partOfSpeech: pos || null,
            exampleKo,
            exampleZh,
            exampleSource,
          },
        });
        updated++;
        continue;
      }
      seen.add(key);
      toCreate.push({
        hangul,
        meaningCn: meaning || '(待补充释义)',
        partOfSpeech: pos || null,
        hanja: null,
        frequency: 3, // 默认词频分层，可在 config.json 按书配
        bookId: book.id,
        exampleKo,
        exampleZh,
        exampleSource,
      });
      created++;
    }

    const CHUNK = 500;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      await prisma.word.createMany({ data: toCreate.slice(i, i + CHUNK) });
    }
    totalCreated += created;
    totalUpdated += updated;
    console.log(`📗 ${bookName}: 新增 ${created} 词，更新 ${updated} 词`);
  }

  console.log(`\n🎉 导入完成：共新增 ${totalCreated} 词，更新 ${totalUpdated} 词`);
  console.log(`   视频例句词 ${hangulWithVideo.size} 个（未写文本例句）`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
