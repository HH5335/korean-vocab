// 批量导入词表：延世韩国语 1~6（data/yonsei-vol-*.csv）+ TOPIK（data/topik-results.tsv）
// 运行：在 server 目录执行 npx tsx scripts/import-words.ts
// 可重复运行：已存在的 (词书+单词) 会自动跳过
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const DATA_DIR = path.resolve(process.cwd(), '../data');

// ---------- 简易 CSV 解析（支持引号包裹字段、转义引号） ----------
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

// ---------- TSV 解析（TOPIK 文件用制表符分隔） ----------
function parseTSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text
    .split('\n')
    .map((line) => line.split('\t').map((f) => f.replace(/\r$/, ''))) // 处理 CRLF 行尾
    .filter((r) => r.some((f) => f.trim() !== ''));
}

// ---------- 词性映射 ----------
const POS_KO: Record<string, string> = {
  '명사': '[名]', '동사': '[动]', '형용사': '[形]', '부사': '[副]', '감탄사': '[感]',
  '대명사': '[代]', '수사': '[数]', '관형사': '[冠]', '접사': '[缀]',
  '의존 명사': '[依存名]', '보조 동사': '[补助动]', '보조 형용사': '[补助形]',
  '표현': '[词组]', '조사': '[助]',
};
const POS_ZH: Record<string, string> = {
  '名': '[名]', '动': '[动]', '形': '[形]', '副': '[副]', '叹': '[感]', '感': '[感]',
  '代': '[代]', '数': '[数]', '冠': '[冠]', '缀': '[缀]', '表达': '[词组]',
  '助': '[助]', '依存名': '[依存名]', '补助动': '[补助动]', '补助形': '[补助形]',
};
function mapPos(posKo: string, posZh: string): string | null {
  if (posZh && POS_ZH[posZh.trim()]) return POS_ZH[posZh.trim()];
  if (posKo && POS_KO[posKo.trim()]) return POS_KO[posKo.trim()];
  return posZh || posKo || null;
}

// ---------- 汉字提取（从 origin_detail 取首个 CJK 词段） ----------
const HANJA_BLACKLIST = new Set(['汉字词', '漢字語', '固有词', '固有語', '外来语', '外来語', '敬语终结', '敬语', '汉字', '漢字']);
function extractHanja(originType: string, originDetail: string): string | null {
  if (!originDetail) return null;
  const hasCjk = /[一-鿿]/.test(originDetail);
  if (!hasCjk) return null;
  // 只有带 "+"（词根组合）或明确标注汉字词时才提取，避免误取元数据
  if (!originDetail.includes('+') && !/한자|sino|漢字/i.test(originType)) return null;
  const match = originDetail.match(/[一-鿿]+/);
  if (!match) return null;
  if (HANJA_BLACKLIST.has(match[0])) return null;
  return match[0];
}

// ---------- 主流程 ----------
async function main() {
  // 1. 确保词书存在（TOPIK 中级是新增的）
  const bookDefs = [
    { name: '延世韩国语 1', category: 'yonsei', level: 'beginner' },
    { name: '延世韩国语 2', category: 'yonsei', level: 'beginner' },
    { name: '延世韩国语 3', category: 'yonsei', level: 'intermediate' },
    { name: '延世韩国语 4', category: 'yonsei', level: 'intermediate' },
    { name: '延世韩国语 5', category: 'yonsei', level: 'advanced' },
    { name: '延世韩国语 6', category: 'yonsei', level: 'advanced' },
    { name: 'TOPIK 初级词表', category: 'topik', level: 'beginner' },
    { name: 'TOPIK 中级词表', category: 'topik', level: 'intermediate' },
    { name: 'TOPIK 中高级词表', category: 'topik', level: 'advanced' },
  ];
  const bookIds: Record<string, string> = {};
  for (const b of bookDefs) {
    const existing = await prisma.wordBook.findFirst({ where: { name: b.name } });
    if (existing) bookIds[b.name] = existing.id;
    else bookIds[b.name] = (await prisma.wordBook.create({ data: b })).id;
  }
  console.log('📚 词书就绪:', Object.keys(bookIds).length, '本');

  // 2. 已存在单词的去重集合
  const existingWords = await prisma.word.findMany({ select: { bookId: true, hangul: true } });
  const seen = new Set(existingWords.map((w) => `${w.bookId}|${w.hangul}`));

  const toCreate: Array<{
    hangul: string; meaningCn: string; partOfSpeech: string | null; hanja: string | null;
    frequency: number; bookId: string;
  }> = [];
  let yonseiCount = 0;
  let topikCount = 0;

  // 3. 导入延世 1~6
  for (let vol = 1; vol <= 6; vol++) {
    const file = path.join(DATA_DIR, `yonsei-vol-${vol}.csv`);
    if (!fs.existsSync(file)) { console.warn(`⚠️ 缺少 ${file}，跳过`); continue; }
    const rows = parseCSV(fs.readFileSync(file, 'utf8'));
    const header = rows[0];
    const idx = {
      korean: header.indexOf('korean'), chinese: header.indexOf('chinese'), english: header.indexOf('english'),
      pos: header.indexOf('pos'), posZh: header.indexOf('pos_zh'),
      originType: header.indexOf('origin_type'), originDetail: header.indexOf('origin_detail'),
    };
    const bookId = bookIds[`延世韩国语 ${vol}`];
    for (const r of rows.slice(1)) {
      const hangul = r[idx.korean]?.trim();
      const chinese = r[idx.chinese]?.trim();
      const english = r[idx.english]?.trim();
      if (!hangul) continue;
      const key = `${bookId}|${hangul}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toCreate.push({
        hangul,
        meaningCn: chinese || english || '(待补充释义)',
        partOfSpeech: mapPos(r[idx.pos] ?? '', r[idx.posZh] ?? ''),
        hanja: extractHanja(r[idx.originType] ?? '', r[idx.originDetail] ?? ''),
        frequency: vol, // 册数作为词频分层（词汇量检测抽样用）
        bookId,
      });
      yonseiCount++;
    }
    console.log(`✅ 延世韩国语 ${vol}: +${rows.length - 1} 行（新增 ${yonseiCount} 词）`);
  }

  // 4. 导入 TOPIK（释义暂为韩语 explanation，后续用 krdict API 补中文）
  const topikFile = path.join(DATA_DIR, 'topik-results.tsv');
  if (fs.existsSync(topikFile)) {
    const rows = parseTSV(fs.readFileSync(topikFile, 'utf8'));
    const header = rows[0];
    const idx = {
      rank: header.indexOf('rank'), word: header.indexOf('word'), pos: header.indexOf('part_of_speech'),
      hanja: header.indexOf('hanja'), explanation: header.indexOf('explanation'),
      nikl: header.indexOf('nikl_level'), topik: header.indexOf('topik_level'),
    };
    const topikSeen = new Set<string>();
    for (const r of rows.slice(1)) {
      const hangul = r[idx.word]?.trim();
      if (!hangul || topikSeen.has(hangul)) continue;
      topikSeen.add(hangul);
      const rank = parseInt(r[idx.rank] ?? '', 10);
      const topikLevel = r[idx.topik]?.trim() ?? '';
      const nikl = r[idx.nikl]?.trim() ?? '';
      // 分级 → 词书
      let bookName: string | null = null;
      if (topikLevel === 'A') bookName = 'TOPIK 初级词表';
      else if (topikLevel === 'B') bookName = 'TOPIK 中级词表';
      else if (topikLevel === 'C') bookName = 'TOPIK 中高级词表';
      else if (nikl === '초급') bookName = 'TOPIK 初级词表';
      else if (nikl === '중급') bookName = 'TOPIK 中级词表';
      if (!bookName) continue;
      const bookId = bookIds[bookName];
      const key = `${bookId}|${hangul}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // 词频分层：按 rank 分 6 档
      const freq = Number.isNaN(rank) ? (nikl === '초급' ? 2 : 4) : rank <= 800 ? 1 : rank <= 1600 ? 2 : rank <= 2500 ? 3 : rank <= 3500 ? 4 : rank <= 5000 ? 5 : 6;
      toCreate.push({
        hangul,
        meaningCn: r[idx.explanation]?.trim() || '(待补充释义)',
        partOfSpeech: mapPos(r[idx.pos] ?? '', ''),
        hanja: r[idx.hanja]?.trim() || null,
        frequency: freq,
        bookId,
      });
      topikCount++;
    }
    console.log(`✅ TOPIK: +${topikCount} 词`);
  } else {
    console.warn(`⚠️ 缺少 ${topikFile}，跳过`);
  }

  // 5. 分批写入
  const CHUNK = 500;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    await prisma.word.createMany({ data: toCreate.slice(i, i + CHUNK) });
  }
  console.log(`\n🎉 导入完成：共写入 ${toCreate.length} 个单词（延世 ${yonseiCount} + TOPIK ${topikCount}）`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
