// 与后端 Prisma 模型对应的类型定义

export interface WordBook {
  id: string;
  name: string;
  category: 'yonsei' | 'topik' | 'textbook';
  level: string; // beginner | intermediate | advanced
  _count?: { words: number };
}

export interface Word {
  id: string;
  hangul: string;
  meaningCn: string;
  partOfSpeech: string | null;
  hanja: string | null;
  frequency: number;
  bookId: string;
  exampleKo?: string | null; // 文本例句（韩语）；有视频映射的词无此字段
  exampleZh?: string | null; // 例句中文翻译
  exampleSource?: string | null; // book（书中例句）| ai（AI 生成）
}

/** 干扰项候选（轻量，仅出题所需字段） */
export interface DistractorCandidate {
  id: string;
  hangul: string;
  meaningCn: string;
}

export interface MediaMapping {
  id: string;
  wordId: string;
  sourceType: 'song' | 'going';
  sourceName: string;
  artist: string | null;
  quote: string;
  surface: string | null;
  startTime: number;
  endTime: number;
  linkUrl: string | null;
  audioUrl: string | null;
  quoteZh?: string | null; // 片段原句的中文翻译（歌词导入 / GOING 内嵌字幕 OCR）
  verified: boolean;
  videoUrl?: string | null; // 后端按磁盘文件是否存在附加：mp4 完整 URL（无 #t 片段），无文件时为 null
}

export interface LyricsSource {
  sourceName: string;
  sourceType: 'song' | 'going';
  artist: string | null;
  wordCount: number;
}

export interface FeaturedMapping extends MediaMapping {
  word: Word;
}

export interface StudyWord extends Word {
  mediaMappings: MediaMapping[];
}

export interface Overview {
  todayLearned: number;
  todayGoal: number;
  streak: number;
  dueCount: number;
  errorCount: number;
  learnedTotal: number;
}

export interface ReviewItem {
  id: string;
  wordId: string;
  stage: number;
  interval: number;
  reps: number;
  correctCount: number;
  wrongCount: number;
  nextReviewAt: string | null;
  word: StudyWord;
}

export interface ErrorItem {
  id: string;
  wordId: string;
  errorCount: number;
  lastErrorAt: string;
  word: StudyWord;
}

export interface VocabSample {
  totalWords: number;
  sample: Word[];
}

export interface VocabRecord {
  id: string;
  estimate: number;
  toplevel: string;
  createdAt: string;
}

export interface StatsDetail {
  dayCounts: Record<string, number>;
  totalCorrect: number;
  totalWrong: number;
  totalReps: number;
  learned: number;
  mastered: number;
  errors: number;
  stageDist: Record<number, number>;
}

// ---------- 认证 ----------

export interface AuthUser {
  id: string;
  username: string;
  dailyGoal: number;
  isAdmin: boolean;
}

// ---------- 管理后台 ----------

export interface AdminUserRow {
  username: string;
  createdAt: string;
  isAdmin: boolean;
  sessionsEver: number;
  activeToday: boolean;
}

export interface AdminLoginRow {
  username: string;
  createdAt: string;
}

export interface AdminStats {
  users: AdminUserRow[];
  recentLogins: AdminLoginRow[];
  dailyActive: { date: string; activeUsers: number }[];
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
