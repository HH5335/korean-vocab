import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { playClip, playWordAudio, stopAllAudio } from '../audio';
import type { DistractorCandidate, StudyWord } from '../types';

// ---------- 题型与数据 ----------
type QType = 'cn2kr' | 'kr2cn' | 'cn2krType' | 'listen';

interface Question {
  type: QType;
  word: StudyWord;
  options?: string[]; // 选择题选项（含正确项，已打乱）
  answer: string; // 正确项内容
}

const TYPE_LABEL: Record<QType, string> = {
  cn2kr: '🇨🇳 看中文选韩语',
  kr2cn: '🇰🇷 看韩语选中文',
  cn2krType: '⌨️ 看中文拼写韩语',
  listen: '🎧 听韩语选中文',
};

const ALL_TYPES: QType[] = ['cn2kr', 'kr2cn', 'cn2krType', 'listen'];
const UNCERTAIN = '🤔 不确定'; // 选择题末尾的放弃选项

// 夸奖语
const PRAISE_CORRECT = ['做得好！👏', '잘했어요! 최고예요!', '정답! 대박!', '太棒了！', '아주 좋아요!'];
const PRAISE_WRONG = ['没关系，再来一次！💪', '아쉬워요... 다시 도전!', '错了也没事，记住它！', '파이팅!'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 出题 ----------

function buildQuestion(
  word: StudyWord,
  type: QType,
  d: { spell: DistractorCandidate[]; meaning: DistractorCandidate[] },
): Question {
  if (type === 'cn2kr') {
    const options = [...new Set([word.hangul, ...d.spell.map((x) => x.hangul)])].slice(0, 4);
    return { type, word, options: shuffle(options), answer: word.hangul };
  }
  if (type === 'kr2cn' || type === 'listen') {
    const options = [...new Set([word.meaningCn, ...d.meaning.map((x) => x.meaningCn)])].slice(0, 4);
    return { type, word, options: shuffle(options), answer: word.meaningCn };
  }
  return { type, word, answer: word.hangul }; // 拼写题
}

// 同词不连续：贪心取"剩余题最多且与上一题不同"的词，仅剩同词时兜底追加
function arrangeQuestions(qs: Question[]): Question[] {
  const byWord = new Map<string, Question[]>();
  for (const q of qs) {
    if (!byWord.has(q.word.id)) byWord.set(q.word.id, []);
    byWord.get(q.word.id)!.push(q);
  }
  const result: Question[] = [];
  let lastId = '';
  while (result.length < qs.length) {
    let bestId: string | null = null;
    for (const [id, arr] of byWord) {
      if (arr.length === 0 || id === lastId) continue;
      if (bestId === null || arr.length > byWord.get(bestId)!.length) bestId = id;
    }
    if (bestId === null) {
      for (const arr of byWord.values()) result.push(...arr);
      break;
    }
    const arr = byWord.get(bestId)!;
    result.push(arr.splice(Math.floor(Math.random() * arr.length), 1)[0]);
    lastId = bestId;
  }
  return result;
}

// 出题：抽 10 个已学词 → 后端算相近干扰项 → 每词 2~3 种题型 → 打乱 + 同词不连续
async function makeQuestions(pool: StudyWord[]): Promise<Question[]> {
  const picked = shuffle(pool).slice(0, Math.min(10, pool.length));
  if (picked.length === 1) {
    // 只学 1 词：选择题无干扰项，退化为 2 道拼写题
    const w = picked[0];
    return [
      { type: 'cn2krType', word: w, answer: w.hangul },
      { type: 'cn2krType', word: w, answer: w.hangul },
    ];
  }
  const dist = await api.distractors(picked.map((w) => ({ id: w.id, hangul: w.hangul, meaningCn: w.meaningCn })));
  const questions: Question[] = [];
  for (const word of picked) {
    const n = 2 + Math.floor(Math.random() * 2); // 每词 2~3 种题型
    for (const type of shuffle(ALL_TYPES).slice(0, n)) {
      questions.push(buildQuestion(word, type, dist[word.id] ?? { spell: [], meaning: [] }));
    }
  }
  return arrangeQuestions(shuffle(questions));
}

// ---------- 释义弹窗（答后展示，含歌词语境/视频片段，可展开） ----------
function RevealModal({
  q,
  correct,
  last,
  onNext,
}: {
  q: Question;
  correct: boolean;
  last: boolean;
  onNext: () => void;
}) {
  const [open, setOpen] = useState(false); // 展开片段
  return (
    <div className={`fb-overlay ${correct ? 'fb-correct' : 'fb-wrong'}`}>
      <div className="fb-pop">
        <div className="fb-mark">{correct ? '✓' : '✗'}</div>
        <div className="fb-hangul">{q.word.hangul}</div>
        <button
          className="btn-tts"
          onClick={(e) => {
            e.stopPropagation();
            playWordAudio(q.word);
          }}
        >
          🔊
        </button>
        <div className="fb-mean">{q.word.meaningCn}</div>
        <div className="fb-tags">
          {q.word.partOfSpeech && <span className="tag tag-blue">{q.word.partOfSpeech}</span>}
          {q.word.hanja && <span className="tag tag-pink">汉字：{q.word.hanja}</span>}
        </div>
        {q.word.mediaMappings.length > 0 && (
          <button className="fc-prev fb-expand" onClick={() => setOpen((v) => !v)}>
            🎬 看看它出现的片段（{q.word.mediaMappings.length}）{open ? '▲' : '▼'}
          </button>
        )}
        {open && (
          <div className="fb-maps">
            {q.word.mediaMappings.map((m) => (
              <div key={m.id} className="fc-map">
                <div className="fc-quote">“{m.quote}”</div>
                {m.quoteZh && <div className="fc-quote-zh">💬 {m.quoteZh}</div>}
                <div className="fc-src">
                  {m.sourceType === 'song' ? '🎵' : '📺'}{' '}
                  {m.artist ? `${m.artist} ` : ''}
                  {m.sourceName}
                  {!m.verified && <span style={{ marginLeft: 6, color: '#e67e22' }}>· 待校对</span>}
                </div>
                <div className="actions" style={{ display: 'flex', gap: 8 }}>
                  {m.linkUrl ? (
                    <a href={m.linkUrl} target="_blank" rel="noreferrer">
                      <button className="btn-play" onClick={(e) => e.stopPropagation()}>
                        ▶ 跳转播放
                      </button>
                    </a>
                  ) : (
                    <span className="chip-pending">⏳ 跳转链接待补充</span>
                  )}
                  {m.audioUrl ? (
                    <button
                      className="btn-audio"
                      onClick={(e) => {
                        e.stopPropagation();
                        playClip(m.audioUrl!);
                      }}
                    >
                      🔊 站内音频
                    </button>
                  ) : (
                    <span className="chip-pending">⏳ 音频待剪辑</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="fb-praise" style={{ fontSize: 16 }}>
          {correct ? pick(PRAISE_CORRECT) : pick(PRAISE_WRONG)}
        </div>
        <button className="btn-known fb-next" onClick={onNext}>
          {last ? '查看结果 →' : '下一题 →'}
        </button>
      </div>
    </div>
  );
}

// ---------- 页面 ----------
export default function Quiz() {
  const [words, setWords] = useState<StudyWord[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [wrongWords, setWrongWords] = useState<StudyWord[]>([]);
  const [picked, setPicked] = useState<string | null>(null); // 当前题已选选项
  const [typed, setTyped] = useState('');
  const [revealed, setRevealed] = useState(false); // 已作答（释义弹窗显示中）
  const [lastCorrect, setLastCorrect] = useState(false);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 加载已学单词并出题（相近干扰项在 makeQuestions 内异步获取）
  useEffect(() => {
    setLoading(true);
    api
      .learnedWords()
      .then((ws) => {
        setWords(ws);
        return makeQuestions(ws);
      })
      .then(setQuestions)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (questions[qIndex]?.type === 'cn2krType') inputRef.current?.focus();
  }, [qIndex, questions]);

  // 听音题 / 拼写题：出题时自动朗读韩语发音
  useEffect(() => {
    const q = questions[qIndex];
    if (q && (q.type === 'listen' || q.type === 'cn2krType')) playWordAudio(q.word);
  }, [qIndex, questions]);

  const q = questions[qIndex];
  const total = questions.length;

  // 点击卡片空白处重播发音（仅听音题和拼写题）
  function replay() {
    if (q && (q.type === 'listen' || q.type === 'cn2krType')) playWordAudio(q.word);
  }

  // 选择题：点选项（"不确定"→ 答错）
  function choose(option: string) {
    if (!q || revealed) return;
    setPicked(option);
    settle(option === q.answer);
  }

  // 拼写题：回车/提交
  function submitTyped() {
    if (!q || revealed || !typed.trim()) return;
    const correct = typed.trim().normalize('NFC') === q.answer.normalize('NFC');
    setPicked(typed.trim());
    settle(correct);
  }

  // 拼写题"不太确定"：放弃 → 算答错
  function giveUp() {
    if (!q || revealed) return;
    setPicked(null);
    settle(false);
  }

  function settle(correct: boolean) {
    if (!q) return;
    api.learn(q.word.id, correct).catch(() => {}); // 驱动艾宾浩斯复习与错词本
    if (correct) setScore((s) => s + 1);
    else setWrongWords((ws) => (ws.some((w) => w.id === q.word.id) ? ws : [...ws, q.word])); // 同词多题型去重
    setLastCorrect(correct);
    setRevealed(true);
  }

  function nextQuestion() {
    stopAllAudio(); // 翻题/结束：立即停止上一题还在播放的发音/剪辑
    setRevealed(false);
    setPicked(null);
    setTyped('');
    if (qIndex + 1 < total) setQIndex((i) => i + 1);
    else setFinished(true);
  }

  // ---------- 结束页 ----------
  if (finished) {
    const rate = total > 0 ? Math.round((score / total) * 100) : 0;
    return (
      <div className="wrap">
        <div className="placeholder-card">
          <div className="big">{rate >= 80 ? '🏆' : rate >= 60 ? '💪' : '🐯'}</div>
          <h1>测试完成！正确率 {rate}%</h1>
          <p style={{ marginBottom: 20 }}>
            答对 {score} / {total} 题{rate >= 80 ? '，실력이 대단해요!' : rate >= 60 ? '，再接再厉！' : '，错词已进错词本，多复习几次！'}
          </p>
          {wrongWords.length > 0 && (
            <div className="wrong-review">
              <h3>📕 本轮错词（{wrongWords.length}）</h3>
              <div className="wrong-list">
                {wrongWords.map((w) => (
                  <span key={w.id} className="wrong-item">
                    {w.hangul} — {w.meaningCn}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="fc-actions">
            <Link to="/study">
              <button className="fc-prev">📖 回去背诵</button>
            </Link>
            <button
              className="btn-known"
              onClick={() => {
                makeQuestions(words).then(setQuestions);
                setQIndex(0);
                setScore(0);
                setWrongWords([]);
                setFinished(false);
                setPicked(null);
                setTyped('');
                setRevealed(false);
              }}
            >
              🔄 再来一轮
            </button>
            <Link to="/">
              <button className="btn-main">🏠 回首页</button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 空态：还没有已学单词 ----------
  if (words.length === 0 && !loading && !error) {
    return (
      <div className="placeholder">
        <div className="placeholder-card">
          <div className="big">✏️</div>
          <h1>测试题</h1>
          <p>还没有学过的单词，先去背诵页学几个吧 📖</p>
          <div style={{ marginTop: 20 }}>
            <Link to="/study">
              <button className="btn-main">📖 去背诵</button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="wrap"><p style={{ color: 'var(--ink-2)' }}>正在出题…</p></div>;
  if (error) return <div className="wrap"><p style={{ color: '#c0392b' }}>加载失败：{error}</p></div>;
  if (!q) return null; // words 非空时必有题，此处仅类型收窄

  return (
    <div className="wrap">
      {/* 进度 */}
      <div className="quiz-head">
        <h2>✏️ 测试题</h2>
        <span className="tag tag-blue">{TYPE_LABEL[q.type]}</span>
        <div className="quiz-progress">
          <div className="mini-bar" style={{ background: '#e6e9f7', height: 8, borderRadius: 4, overflow: 'hidden', flex: 1 }}>
            <i
              style={{
                display: 'block',
                height: '100%',
                width: `${((qIndex + (revealed ? 1 : 0)) / total) * 100}%`,
                background: 'var(--grad)',
                borderRadius: 4,
              }}
            ></i>
          </div>
          <span>
            {qIndex + 1} / {total} · ✅ {score}
          </span>
        </div>
      </div>

      <div className="quiz-card" onClick={replay}>
        {/* 题干 */}
        {q.type === 'cn2kr' && (
          <div className="q-stem">
            <div className="q-label">选择对应的韩语</div>
            <div className="q-word">{q.word.meaningCn}</div>
            {q.word.hanja && <div className="q-sub">汉字：{q.word.hanja}</div>}
          </div>
        )}
        {q.type === 'kr2cn' && (
          <div className="q-stem">
            <div className="q-label">选择对应的中文</div>
            <div className="q-word">{q.word.hangul}</div>
            <button
              className="btn-tts"
              style={{ width: 44, height: 44, fontSize: 18 }}
              onClick={(e) => {
                e.stopPropagation();
                playWordAudio(q.word);
              }}
            >
              🔊
            </button>
          </div>
        )}
        {q.type === 'cn2krType' && (
          <div className="q-stem">
            <div className="q-label">看中文，拼写韩语</div>
            <div className="q-word">{q.word.meaningCn}</div>
            <input
              ref={inputRef}
              className="q-input"
              value={typed}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
              placeholder="用韩语输入法拼写…"
              disabled={revealed}
            />
            <div className="q-sub" style={{ fontSize: 12, opacity: 0.75 }}>点击空白处播放</div>
            <div className="q-controls">
              <button
                className="btn-tts"
                style={{ width: 44, height: 44, fontSize: 18 }}
                onClick={(e) => {
                  e.stopPropagation();
                  playWordAudio(q.word);
                }}
              >
                🔊
              </button>
              <button
                className="fc-prev"
                onClick={(e) => {
                  e.stopPropagation();
                  giveUp();
                }}
                disabled={revealed}
              >
                🤔 不太确定
              </button>
              <button
                className="btn-known"
                onClick={(e) => {
                  e.stopPropagation();
                  submitTyped();
                }}
                disabled={revealed || !typed.trim()}
              >
                提交
              </button>
            </div>
          </div>
        )}
        {q.type === 'listen' && (
          <div className="q-stem">
            <div className="q-label">听发音，选择对应的中文</div>
            <button
              className="btn-tts"
              onClick={(e) => {
                e.stopPropagation();
                playWordAudio(q.word);
              }}
            >
              🔊 再听一遍
            </button>
            {picked === null && <div className="q-sub" style={{ fontSize: 12, opacity: 0.75 }}>点击空白处播放</div>}
          </div>
        )}

        {/* 选项（选择题，末尾为"不确定"） */}
        {q.options && (
          <div className="q-options">
            {[...q.options, UNCERTAIN].map((opt) => {
              let cls = 'q-option';
              if (opt === UNCERTAIN) cls += ' q-uncertain';
              if (revealed) {
                if (opt === q.answer) cls += ' q-right';
                else if (opt === picked) cls += ' q-wrong-pick';
              } else if (opt === picked) {
                cls += ' q-picked';
              }
              return (
                <button
                  key={opt}
                  className={cls}
                  onClick={(e) => {
                    e.stopPropagation();
                    choose(opt);
                  }}
                  disabled={revealed}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 答后释义弹窗（含下一题） */}
      {revealed && <RevealModal q={q} correct={lastCorrect} last={qIndex + 1 >= total} onNext={nextQuestion} />}
    </div>
  );
}
