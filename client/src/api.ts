import type {
  AdminStats,
  AuthResponse,
  AuthUser,
  DistractorCandidate,
  ErrorItem,
  FeaturedMapping,
  LyricsSource,
  Overview,
  ReviewItem,
  StatsDetail,
  StudyWord,
  VocabRecord,
  VocabSample,
  WordBook,
} from './types';

const BASE = '/api';

// ---------- 登录状态（localStorage） ----------

const TOKEN_KEY = 'korean-vocab-token';
const USER_KEY = 'korean-vocab-user';

export const authStore = {
  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),
  setAuth(token: string, user: AuthUser) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  getUser: (): AuthUser | null => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

// ---------- 请求封装 ----------

function authHeaders(): Record<string, string> {
  const token = authStore.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 响应非 2xx 时抛出后端返回的错误信息（如"用户名或密码错误"） */
async function throwOnError(res: Response, path: string): Promise<void> {
  if (res.ok) return;
  let message = `请求失败: ${path} (HTTP ${res.status})`;
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') message = data.error;
  } catch {
    /* 保留默认信息 */
  }
  // 未登录（且不在登录页）→ 清空本地状态并跳转登录
  if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
    authStore.clear();
    window.location.href = '/login';
  }
  throw new Error(message);
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  await throwOnError(res, path);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  await throwOnError(res, path);
  return res.json() as Promise<T>;
}

export const api = {
  /** 注册（注册即登录） */
  register: (username: string, password: string) => post<AuthResponse>('/auth/register', { username, password }),
  /** 登录 */
  login: (username: string, password: string) => post<AuthResponse>('/auth/login', { username, password }),
  /** 当前登录用户 */
  me: () => request<AuthUser>('/auth/me'),
  /** 退出登录 */
  logout: () => post<{ ok: boolean }>('/auth/logout', {}),
  /** 单词书列表 */
  books: () => request<WordBook[]>('/books'),
  /** 某本词书的单词（含歌词映射） */
  bookWords: (bookId: string) => request<StudyWord[]>(`/books/${bookId}/words`),
  /** 主页精选歌词/综艺映射 */
  featuredMappings: () => request<FeaturedMapping[]>('/mappings/featured'),
  /** 学习概览统计 */
  overview: () => request<Overview>('/stats/overview'),
  /** 详细统计（热力图/面板） */
  statsDetail: () => request<StatsDetail>('/stats/detail'),
  /** 今日到期待复习单词 */
  dueReviews: () => request<ReviewItem[]>('/review/due'),
  /** 错词本列表 */
  errorWords: () => request<ErrorItem[]>('/error-words'),
  /** 记录背诵结果（认识/不认识） */
  learn: (wordId: string, known: boolean) => post('/progress/learn', { wordId, known }),
  /** 歌词学习：来源列表 */
  lyricsSources: () => request<LyricsSource[]>('/lyrics/sources'),
  /** 歌词学习：某个来源的单词 */
  lyricsSourceWords: (name: string) => request<FeaturedMapping[]>(`/lyrics/source/${encodeURIComponent(name)}/words`),
  /** 歌词学习：混合随机出词 */
  lyricsMixed: (count = 20) => request<FeaturedMapping[]>(`/lyrics/mixed?count=${count}`),
  /** 当前用户全部已学单词（含歌词映射）——测试题出题源 */
  learnedWords: () => request<StudyWord[]>('/quiz/learned-words'),
  /** 相近干扰项：按题目词批量计算（拼写/发音相近、意思相近，可含未学词） */
  distractors: (words: { id: string; hangul: string; meaningCn: string }[]) =>
    post<Record<string, { spell: DistractorCandidate[]; meaning: DistractorCandidate[] }>>('/quiz/distractors', { words }),
  /** 词汇量检测抽样 */
  vocabSample: () => request<VocabSample>('/vocab-test/sample'),
  /** 保存词汇量检测结果 */
  saveVocabTest: (estimate: number, toplevel: string) =>
    post<VocabRecord>('/vocab-test', { estimate, toplevel }),
  /** 词汇量检测历史 */
  vocabHistory: () => request<VocabRecord[]>('/vocab-test/history'),
  /** 管理后台统计（仅管理员） */
  adminStats: () => request<AdminStats>('/admin/stats'),
};
