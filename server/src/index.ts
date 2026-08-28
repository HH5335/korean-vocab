import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword, createSessionToken, requireAuth, requireAdmin, extractBearerToken } from './auth.js';

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());

// 站内媒体文件（歌词剪辑音频等）：/media/clips/xxx.mp3
app.use('/media', express.static(path.resolve(__dirname, '../../media')));

const MEDIA_DIR = path.resolve(__dirname, '../../media');
const videoUrlCache = new Map<string, string | null>(); // sourceType:sourceName → videoUrl

// 某条映射对应的 mp4 是否存在，存在则返回站内 URL（磁盘用原始名查，URL 才编码）
function mediaVideoUrl(m: { sourceType: string; sourceName: string }): string | null {
  const key = `${m.sourceType}:${m.sourceName}`;
  if (videoUrlCache.has(key)) return videoUrlCache.get(key)!;
  const folder = m.sourceType === 'song' ? 'songs' : 'going';
  const exists = fs.existsSync(path.join(MEDIA_DIR, folder, `${m.sourceName}.mp4`));
  const url = exists ? `/media/${folder}/${encodeURIComponent(m.sourceName)}.mp4` : null;
  videoUrlCache.set(key, url);
  return url;
}

// 给单词列表的每条媒体映射附加 videoUrl 字段
function attachVideoUrl<T extends { mediaMappings: Array<{ sourceType: string; sourceName: string }> }>(words: T[]): T[] {
  return words.map((w) => ({
    ...w,
    mediaMappings: w.mediaMappings.map((m) => ({ ...m, videoUrl: mediaVideoUrl(m) })),
  }));
}

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'BluePink 한글 API', time: new Date().toISOString() });
});

// 单词书列表
app.get('/api/books', async (_req, res) => {
  const books = await prisma.wordBook.findMany({
    include: { _count: { select: { words: true } } },
  });
  res.json(books);
});

// 单词书详情：某本词书的单词列表（含歌词映射）
app.get('/api/books/:id/words', async (req, res) => {
  const words = await prisma.word.findMany({
    where: { bookId: req.params.id },
    include: { mediaMappings: true },
    orderBy: { frequency: 'asc' },
  });
  res.json(attachVideoUrl(words));
});

// ---------- 认证 ----------

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

// 注册（注册即登录）
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body ?? {};
  const name = String(username ?? '').trim();
  if (!/^[\w一-龥]{1,20}$/.test(name))
    return res.status(400).json({ error: '用户名需为 1-20 位中英文/数字/下划线' });
  if (typeof password !== 'string' || password.length < 6)
    return res.status(400).json({ error: '密码至少 6 位' });

  const exists = await prisma.user.findUnique({ where: { username: name } });
  if (exists) return res.status(409).json({ error: '用户名已被注册' });

  const user = await prisma.user.create({ data: { username: name, passwordHash: hashPassword(password) } });
  const session = await prisma.session.create({
    data: { token: createSessionToken(), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  res.json({ token: session.token, user: { id: user.id, username: user.username, dailyGoal: user.dailyGoal, isAdmin: user.isAdmin } });
});

// 登录
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = await prisma.user.findUnique({ where: { username: String(username ?? '') } });
  if (!user?.passwordHash || !verifyPassword(String(password ?? ''), user.passwordHash))
    return res.status(401).json({ error: '用户名或密码错误' });

  const session = await prisma.session.create({
    data: { token: createSessionToken(), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  res.json({ token: session.token, user: { id: user.id, username: user.username, dailyGoal: user.dailyGoal, isAdmin: user.isAdmin } });
});

// 当前登录用户
app.get('/api/auth/me', requireAuth(prisma), (req, res) => {
  res.json({ id: req.user!.id, username: req.user!.username, dailyGoal: req.user!.dailyGoal, isAdmin: req.user!.isAdmin });
});

// 退出登录（幂等）
app.post('/api/auth/logout', async (req, res) => {
  const token = extractBearerToken(req);
  if (token) await prisma.session.deleteMany({ where: { token } });
  res.json({ ok: true });
});

// 用户数据接口统一守卫：以下路由需要登录
app.use(
  [
    '/api/progress/learn',
    '/api/review/due',
    '/api/error-words',
    '/api/stats/overview',
    '/api/stats/detail',
    '/api/vocab-test',
    '/api/vocab-test/history',
    '/api/quiz/learned-words',
    '/api/quiz/distractors',
    '/api/plan/today',
  ],
  requireAuth(prisma),
);

// 艾宾浩斯复习间隔（天）：0=当天，之后 1/2/4/7/15
const INTERVALS = [0, 1, 2, 4, 7, 15];

// 记录背诵结果：认识 → 升级复习阶段；不认识 → 重置阶段并进错词本
app.post('/api/progress/learn', async (req, res) => {
  const { wordId, known } = req.body ?? {};
  if (!wordId) return res.status(400).json({ error: '缺少 wordId' });
  const user = req.user!;

  const existing = await prisma.wordProgress.findUnique({
    where: { userId_wordId: { userId: user.id, wordId } },
  });
  const stage = existing ? (known ? Math.min(existing.stage + 1, INTERVALS.length - 1) : 0) : known ? 1 : 0;
  const interval = INTERVALS[stage];
  const nextReviewAt = new Date(Date.now() + interval * 86400000);

  const progress = await prisma.wordProgress.upsert({
    where: { userId_wordId: { userId: user.id, wordId } },
    create: {
      userId: user.id,
      wordId,
      status: 'learning', // 学习过即进入队列（答错当天就会出现在待复习）
      stage,
      interval,
      reps: 1,
      correctCount: known ? 1 : 0,
      wrongCount: known ? 0 : 1,
      nextReviewAt,
      lastReviewedAt: new Date(),
    },
    update: {
      status: stage >= INTERVALS.length - 1 ? 'mastered' : 'learning',
      stage,
      interval,
      reps: { increment: 1 },
      correctCount: { increment: known ? 1 : 0 },
      wrongCount: { increment: known ? 0 : 1 },
      nextReviewAt,
      lastReviewedAt: new Date(),
    },
  });

  // 答错 → 进错词本；答对 → 移出错词本
  if (!known) {
    await prisma.errorWord.upsert({
      where: { userId_wordId: { userId: user.id, wordId } },
      create: { userId: user.id, wordId },
      update: { errorCount: { increment: 1 }, lastErrorAt: new Date() },
    });
  } else {
    await prisma.errorWord.deleteMany({ where: { userId: user.id, wordId } });
  }
  await prisma.studyLog.create({
    data: { userId: user.id, wordId, action: known ? 'learn' : 'wrong' },
  });

  res.json({ ...progress, nextReviewAt });
});

// 今日到期待复习的单词（艾宾浩斯队列）
app.get('/api/review/due', async (req, res) => {
  const user = req.user!;
  const due = await prisma.wordProgress.findMany({
    where: {
      userId: user.id,
      status: { in: ['learning', 'reviewing'] },
      nextReviewAt: { lte: new Date() },
    },
    include: { word: { include: { mediaMappings: true } } },
    orderBy: { nextReviewAt: 'asc' },
  });
  res.json(due);
});

// 错词本列表
app.get('/api/error-words', async (req, res) => {
  const user = req.user!;
  const list = await prisma.errorWord.findMany({
    where: { userId: user.id },
    include: { word: { include: { mediaMappings: true } } },
    orderBy: { lastErrorAt: 'desc' },
  });
  res.json(list);
});

// 学习概览（主页统计卡片）
app.get('/api/stats/overview', async (req, res) => {
  const user = req.user!;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const localDate = (d: Date) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD（本机时区）

  const [due, errorCount, todayLearned, recentLogs, learnedTotal, plan] = await Promise.all([
    prisma.wordProgress.count({
      where: { userId: user.id, status: { in: ['learning', 'reviewing'] }, nextReviewAt: { lte: now } },
    }),
    prisma.errorWord.count({ where: { userId: user.id } }),
    prisma.studyLog.count({ where: { userId: user.id, createdAt: { gte: todayStart } } }),
    prisma.studyLog.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 90 * 86400000) } },
      select: { createdAt: true },
    }),
    prisma.wordProgress.count({ where: { userId: user.id, reps: { gt: 0 } } }),
    prisma.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: localDate(now) } } }),
  ]);

  // 连续打卡天数（今天没学则从昨天起算）
  const days = new Set(recentLogs.map((l) => localDate(l.createdAt)));
  let streak = 0;
  for (let i = 0; i < 90; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (days.has(localDate(d))) streak++;
    else if (i === 0) continue;
    else break;
  }

  res.json({
    todayLearned,
    todayGoal: plan?.target ?? user.dailyGoal,
    streak,
    dueCount: due,
    errorCount,
    learnedTotal,
  });
});

// 词汇量检测：按词频分层抽样
app.get('/api/vocab-test/sample', async (_req, res) => {
  const PER_LEVEL = 5;
  const sample = [];
  for (const freq of [1, 2, 3, 4, 5, 6]) {
    const pool = await prisma.word.findMany({ where: { frequency: freq } });
    const picked = pool.sort(() => Math.random() - 0.5).slice(0, PER_LEVEL);
    sample.push(...picked);
  }
  const totalWords = await prisma.word.count();
  res.json({ totalWords, sample });
});

// 保存词汇量检测结果
app.post('/api/vocab-test', async (req, res) => {
  const { estimate, toplevel } = req.body ?? {};
  if (!estimate || !toplevel) return res.status(400).json({ error: '缺少 estimate/toplevel' });
  const user = req.user!;
  const record = await prisma.vocabTest.create({
    data: { userId: user.id, estimate, toplevel },
  });
  res.json(record);
});

// 词汇量检测历史
app.get('/api/vocab-test/history', async (req, res) => {
  const user = req.user!;
  const history = await prisma.vocabTest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  res.json(history);
});

// ---------- 测试题 ----------

// 当前用户全部已学单词（测试题出题源；WordProgress 有记录即已学）
app.get('/api/quiz/learned-words', async (req, res) => {
  const user = req.user!;
  const records = await prisma.wordProgress.findMany({
    where: { userId: user.id },
    include: { word: { include: { mediaMappings: true } } },
    orderBy: { learnedAt: 'desc' },
  });
  res.json(records.map((r) => r.word));
});

// 编辑距离（韩文为表音文字，字串距离小≈发音/拼写相近）
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j < prev.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// 中文释义的汉字字符交集计数（意思相近度量）
function meaningOverlap(a: string, b: string): number {
  const charsOf = (s: string) => new Set(s.match(/[一-鿿]/g) ?? []);
  const set = charsOf(a);
  return [...charsOf(b)].filter((c) => set.has(c)).length;
}

// 释义中不同汉字的个数
function cnCharCount(s: string): number {
  return new Set(s.match(/[一-鿿]/g) ?? []).size;
}

// 相近干扰项：从全部单词（可含未学词）为题目词计算相近候选
// 拼写/发音相近（编辑距离 ≤2，按距离升序）与意思相近（释义汉字交集 ≥2，按交集降序），不足 4 个随机补足
app.post('/api/quiz/distractors', async (req, res) => {
  const { words } = req.body ?? {};
  if (!Array.isArray(words) || words.length === 0 || words.length > 20)
    return res.status(400).json({ error: 'words 需为 1~20 个词的数组' });

  const targets = words as Array<{ id: string; hangul: string; meaningCn: string }>;
  const targetIds = new Set(targets.map((w) => w.id));
  const all = await prisma.word.findMany({
    where: { id: { notIn: [...targetIds] } },
    select: { id: true, hangul: true, meaningCn: true },
  });

  const result: Record<string, { spell: typeof all; meaning: typeof all }> = {};
  for (const t of targets) {
    // 排除与题目同拼写/同释义的候选，避免选项出现重复
    const others = all.filter((c) => c.hangul !== t.hangul && c.meaningCn !== t.meaningCn);
    // 意思相近阈值：释义很短（≤2 个汉字）时 1 个共同字即算相近
    const minOverlap = cnCharCount(t.meaningCn) <= 2 ? 1 : 2;
    const spellScore = new Map<string, number>();
    const meaningScore = new Map<string, number>();
    const spellCand: typeof all = [];
    const meaningCand: typeof all = [];
    for (const c of others) {
      const d = editDistance(t.hangul, c.hangul);
      if (d <= 2) {
        spellCand.push(c);
        spellScore.set(c.id, d);
      }
      const o = meaningOverlap(t.meaningCn, c.meaningCn);
      if (o >= minOverlap) {
        meaningCand.push(c);
        meaningScore.set(c.id, o);
      }
    }
    const spell = spellCand.sort((a, b) => spellScore.get(a.id)! - spellScore.get(b.id)!).slice(0, 4);
    const meaning = meaningCand
      .sort((a, b) => meaningScore.get(b.id)! - meaningScore.get(a.id)! || a.meaningCn.length - b.meaningCn.length)
      .slice(0, 4);
    const used = new Set(spell.map((c) => c.id));
    const pool = [...others].sort(() => Math.random() - 0.5);
    for (const c of pool) {
      if (spell.length >= 4) break;
      if (!used.has(c.id)) {
        spell.push(c);
        used.add(c.id);
      }
    }
    // 随机补足 meaning 选项时只选含中文汉字的释义（部分词条释义是韩语，不能当选项）
    const poolCn = pool.filter((c) => /[一-鿿]/.test(c.meaningCn));
    for (const c of poolCn) {
      if (meaning.length >= 4) break;
      if (!used.has(c.id)) meaning.push(c);
    }
    result[t.id] = { spell, meaning };
  }
  res.json(result);
});

// 按 ID 批量取单词（检测指定词列表用）
app.get('/api/words', async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
  if (ids.length === 0) return res.json([]);
  const words = await prisma.word.findMany({
    where: { id: { in: ids.slice(0, 200) } },
    include: { mediaMappings: true },
  });
  res.json(attachVideoUrl(words));
});

// 歌词学习：所有来源（歌/综艺）及覆盖词数
app.get('/api/lyrics/sources', async (_req, res) => {
  const sources = await prisma.mediaMapping.findMany({
    select: { sourceName: true, sourceType: true, artist: true, wordId: true },
  });
  const grouped = new Map<string, { sourceName: string; sourceType: string; artist: string | null; wordIds: Set<string> }>();
  for (const s of sources) {
    const key = s.sourceName;
    if (!grouped.has(key)) grouped.set(key, { sourceName: s.sourceName, sourceType: s.sourceType, artist: s.artist, wordIds: new Set() });
    grouped.get(key)!.wordIds.add(s.wordId);
  }
  res.json(
    [...grouped.values()].map((g) => ({
      sourceName: g.sourceName,
      sourceType: g.sourceType,
      artist: g.artist,
      wordCount: g.wordIds.size,
    })),
  );
});

// 歌词学习：某个来源下的单词（每个词带一条代表映射）
app.get('/api/lyrics/source/:name/words', async (req, res) => {
  const name = req.params.name;
  const mappings = await prisma.mediaMapping.findMany({
    where: { sourceName: name },
    include: { word: true },
  });
  // 每个词取第一条映射
  const byWord = new Map<string, (typeof mappings)[number]>();
  for (const m of mappings) if (!byWord.has(m.wordId)) byWord.set(m.wordId, m);
  res.json([...byWord.values()]);
});

// 歌词学习：混合随机出词（歌+综艺）
app.get('/api/lyrics/mixed', async (req, res) => {
  const count = Math.min(Number(req.query.count) || 10, 50);
  const mappings = await prisma.mediaMapping.findMany({ include: { word: true } });
  const byWord = new Map<string, (typeof mappings)[number]>();
  for (const m of mappings) if (!byWord.has(m.wordId)) byWord.set(m.wordId, m);
  const all = [...byWord.values()].sort(() => Math.random() - 0.5).slice(0, count);
  res.json(all);
});

// 详细统计（统计页热力图/数据面板）
app.get('/api/stats/detail', async (req, res) => {
  const user = req.user!;
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 104); // 最近 105 天

  const [logs, progressAgg, learned, mastered, errors, stageGroups] = await Promise.all([
    prisma.studyLog.findMany({
      where: { userId: user.id, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.wordProgress.aggregate({
      where: { userId: user.id },
      _sum: { correctCount: true, wrongCount: true, reps: true },
    }),
    prisma.wordProgress.count({ where: { userId: user.id, reps: { gt: 0 } } }),
    prisma.wordProgress.count({ where: { userId: user.id, status: 'mastered' } }),
    prisma.errorWord.count({ where: { userId: user.id } }),
    prisma.wordProgress.groupBy({
      by: ['stage'],
      where: { userId: user.id },
      _count: { stage: true },
    }),
  ]);

  // 每日活跃次数（热力图数据）
  const dayCounts: Record<string, number> = {};
  for (const l of logs) {
    const key = l.createdAt.toLocaleDateString('sv-SE');
    dayCounts[key] = (dayCounts[key] ?? 0) + 1;
  }

  const stageDist: Record<number, number> = {};
  for (const g of stageGroups) stageDist[g.stage] = g._count.stage;

  res.json({
    dayCounts,
    totalCorrect: progressAgg._sum.correctCount ?? 0,
    totalWrong: progressAgg._sum.wrongCount ?? 0,
    totalReps: progressAgg._sum.reps ?? 0,
    learned,
    mastered,
    errors,
    stageDist,
  });
});

// ---------- 管理后台 ----------

// 管理统计：注册用户 / 最近登录 / 近 14 天每日活跃（仅管理员）
app.get('/api/admin/stats', requireAuth(prisma), requireAdmin(), async (req, res) => {
  const now = new Date();
  const localDate = (d: Date) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD（本机时区）

  const [users, sessions, recentLogs] = await Promise.all([
    prisma.user.findMany({
      where: { passwordHash: { not: null } },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { sessions: true } } },
    }),
    prisma.session.findMany({ select: { userId: true, createdAt: true } }),
    prisma.studyLog.findMany({
      where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13) } },
      select: { userId: true, createdAt: true },
    }),
  ]);

  // 每个用户近 14 天的活跃日期集合
  const activeByUser = new Map<string, Set<string>>();
  for (const l of recentLogs) {
    if (!activeByUser.has(l.userId)) activeByUser.set(l.userId, new Set());
    activeByUser.get(l.userId)!.add(localDate(l.createdAt));
  }
  const todayKey = localDate(now);

  // 近 14 天每日活跃人数（旧 → 新）
  const dailyActive = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = localDate(d);
    let n = 0;
    for (const days of activeByUser.values()) if (days.has(key)) n++;
    dailyActive.push({ date: key, activeUsers: n });
  }

  res.json({
    users: users.map((u) => ({
      username: u.username,
      createdAt: u.createdAt,
      isAdmin: u.isAdmin,
      sessionsEver: u._count.sessions,
      activeToday: activeByUser.get(u.id)?.has(todayKey) ?? false,
    })),
    recentLogins: sessions
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 30)
      .map((s) => ({
        username: users.find((u) => u.id === s.userId)?.username ?? '?',
        createdAt: s.createdAt,
      })),
    dailyActive,
  });
});

// 精选歌词/综艺映射（主页展示）
app.get('/api/mappings/featured', async (_req, res) => {
  const featured = await prisma.mediaMapping.findMany({
    take: 3,
    orderBy: { createdAt: 'desc' },
    include: { word: true },
  });
  res.json(featured);
});

// 今日计划
app.get('/api/plan/today', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const plan = await prisma.dailyPlan.findUnique({
    where: { userId_date: { userId: req.user!.id, date: today } },
  });
  res.json({ date: today, plan: plan ?? null });
});

// ---------- 前端静态托管（生产模式：client/dist） ----------
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
app.use(express.static(CLIENT_DIST));
// SPA 兜底：未匹配任何路由的 GET 请求返回 index.html（排除 /api、/media）
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 BluePink 한글 API 运行在 http://localhost:${PORT}`);
  ensureDbReady(); // 不阻塞：健康检查立即通过，数据后台重建（Render 冷启动）
});

// Render 免费实例磁盘是临时的：每次启动后台跑一次幂等 bootstrap 重建词库
// 本地生产模式也触发（词库非空 → 秒过，无副作用）；SKIP_BOOTSTRAP=1 可跳过
function ensureDbReady() {
  if (process.env.SKIP_BOOTSTRAP === '1') {
    console.log('⏭ SKIP_BOOTSTRAP=1，跳过初始化');
    return;
  }
  const serverDir = path.resolve(__dirname, '..'); // server/dist → server
  // 直接用 node 调 tsx CLI 入口（Windows 上 spawn npx.cmd 会 EINVAL）
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve('tsx/cli');
  const child = spawn(process.execPath, [tsxCli, 'scripts/bootstrap.ts'], {
    cwd: serverDir,
    stdio: 'inherit', // 输出直接进 Render 日志
  });
  child.on('error', (e) => console.error('bootstrap 启动失败:', e.message));
  child.on('exit', (code) => console.log(`bootstrap 退出码 ${code}（0=成功）`));
}
