// 种子数据：单词书 + 示例单词 + 歌词/综艺映射
// 运行：npx prisma db seed
// 完整词表后续会通过批量导入脚本写入（见 scripts/import-words.ts，待开发）
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.wordBook.count();
  if (existing > 0) {
    console.log('⚠️ 词书已存在，跳过种子数据');
    return;
  }

  // 1. 单词书
  const bookDefs = [
    { name: '延世韩国语 1', category: 'yonsei', level: 'beginner' },
    { name: '延世韩国语 2', category: 'yonsei', level: 'beginner' },
    { name: '延世韩国语 3', category: 'yonsei', level: 'intermediate' },
    { name: '延世韩国语 4', category: 'yonsei', level: 'intermediate' },
    { name: '延世韩国语 5', category: 'yonsei', level: 'advanced' },
    { name: '延世韩国语 6', category: 'yonsei', level: 'advanced' },
    { name: 'TOPIK 初级词表', category: 'topik', level: 'beginner' },
    { name: 'TOPIK 中高级词表', category: 'topik', level: 'advanced' },
  ];
  const bookIds: Record<string, string> = {};
  for (const b of bookDefs) {
    const created = await prisma.wordBook.create({ data: b });
    bookIds[b.name] = created.id;
  }

  // 2. 示例单词（完整词表后续批量导入）
  const wordDefs: Array<{
    hangul: string; meaningCn: string; pos: string; hanja?: string; freq: number; book: string;
  }> = [
    { hangul: '사랑하다', meaningCn: '爱；喜欢', pos: '[动]', freq: 2, book: '延世韩国语 1' },
    { hangul: '기분', meaningCn: '心情；气氛', pos: '[名]', hanja: '氣分', freq: 2, book: '延世韩国语 1' },
    { hangul: '파이팅', meaningCn: '加油！', pos: '[感]', freq: 3, book: '延世韩国语 1' },
    { hangul: '미안하다', meaningCn: '对不起；抱歉', pos: '[形]', freq: 2, book: '延世韩国语 1' },
    { hangul: '학교', meaningCn: '学校', pos: '[名]', hanja: '學校', freq: 1, book: '延世韩国语 1' },
    { hangul: '학생', meaningCn: '学生', pos: '[名]', hanja: '學生', freq: 1, book: '延世韩国语 1' },
    { hangul: '공부', meaningCn: '学习', pos: '[名]', hanja: '工夫', freq: 1, book: '延世韩国语 1' },
    { hangul: '노래', meaningCn: '歌；歌曲', pos: '[名]', freq: 2, book: '延世韩国语 1' },
    { hangul: '친구', meaningCn: '朋友', pos: '[名]', hanja: '親舊', freq: 1, book: '延世韩国语 1' },
    { hangul: '가족', meaningCn: '家人；家庭', pos: '[名]', hanja: '家族', freq: 1, book: '延世韩国语 1' },
    { hangul: '음식', meaningCn: '食物', pos: '[名]', hanja: '飮食', freq: 1, book: '延世韩国语 1' },
    { hangul: '시간', meaningCn: '时间', pos: '[名]', hanja: '時間', freq: 1, book: '延世韩国语 1' },
    { hangul: '행복', meaningCn: '幸福', pos: '[名]', hanja: '幸福', freq: 2, book: '延世韩国语 2' },
    { hangul: '예쁘다', meaningCn: '漂亮；好看', pos: '[形]', freq: 2, book: '延世韩国语 2' },
    { hangul: '시작하다', meaningCn: '开始', pos: '[动]', hanja: '始作', freq: 2, book: '延世韩国语 2' },
    { hangul: '재미있다', meaningCn: '有趣；有意思', pos: '[形]', freq: 2, book: '延世韩国语 2' },
    { hangul: '맛있다', meaningCn: '好吃', pos: '[形]', freq: 1, book: '延世韩国语 1' },
    { hangul: '듣다', meaningCn: '听', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '말하다', meaningCn: '说；讲话', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '오늘', meaningCn: '今天', pos: '[名]', freq: 1, book: '延世韩国语 1' },
    { hangul: '내일', meaningCn: '明天', pos: '[名]', freq: 1, book: '延世韩国语 1' },
    { hangul: '가다', meaningCn: '去', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '오다', meaningCn: '来', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '보다', meaningCn: '看', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '읽다', meaningCn: '读', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '쓰다', meaningCn: '写；用', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '있다', meaningCn: '有；在', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '없다', meaningCn: '没有；不在', pos: '[动]', freq: 1, book: '延世韩国语 1' },
    { hangul: '좋다', meaningCn: '好；喜欢', pos: '[形]', freq: 1, book: '延世韩国语 1' },
    { hangul: '고맙다', meaningCn: '感谢', pos: '[形]', freq: 1, book: '延世韩国语 1' },
  ];

  const wordIds: Record<string, string> = {};
  for (const w of wordDefs) {
    const created = await prisma.word.create({
      data: {
        hangul: w.hangul,
        meaningCn: w.meaningCn,
        partOfSpeech: w.pos,
        hanja: w.hanja ?? null,
        frequency: w.freq,
        bookId: bookIds[w.book],
      },
    });
    wordIds[w.hangul] = created.id;
  }

  // 3. 歌词/综艺映射示例（跳转链接待你补充真实地址）
  const mappingDefs = [
    {
      word: '기분', sourceType: 'song', sourceName: '아주 NICE', artist: 'SEVENTEEN',
      quote: '기분 기분 기분이 좋아져!', startTime: 42, endTime: 52, verified: true,
    },
    {
      word: '파이팅', sourceType: 'song', sourceName: '파이팅 해야지', artist: 'BSS (SEVENTEEN)',
      quote: '파이팅 해야지, 파이팅 해야지!', startTime: 35, endTime: 45, verified: true,
    },
    {
      word: '미안하다', sourceType: 'going', sourceName: 'GOING SEVENTEEN 示例片段',
      quote: '미안해요~ 정말 미안해요~', startTime: 12, endTime: 20, verified: false,
    },
  ];
  for (const m of mappingDefs) {
    await prisma.mediaMapping.create({
      data: {
        wordId: wordIds[m.word],
        sourceType: m.sourceType,
        sourceName: m.sourceName,
        artist: m.artist ?? null,
        quote: m.quote,
        startTime: m.startTime,
        endTime: m.endTime,
        verified: m.verified,
      },
    });
  }

  console.log(`✅ 种子数据完成：${bookDefs.length} 本词书、${wordDefs.length} 个单词、${mappingDefs.length} 条歌词映射`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
