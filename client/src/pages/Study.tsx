import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { playClip, playWordAudio, speakKorean, stopSpeaking } from '../audio';
import type { StudyWord, WordBook } from '../types';

// 在例句原句中定位目标词（surface 为句中实际形态），用于高亮
function splitHighlight(quote: string, surface: string | null) {
  if (!surface) return { before: quote, match: '', after: '' };
  const idx = quote.indexOf(surface);
  if (idx < 0) return { before: quote, match: '', after: '' };
  return { before: quote.slice(0, idx), match: quote.slice(idx, idx + surface.length), after: quote.slice(idx + surface.length) };
}

// 选展示用的映射：优先已校对，否则第一条
function pickMapping(word: StudyWord) {
  return word.mediaMappings.find((m) => m.verified) ?? word.mediaMappings[0];
}

// 片段起止：只含目标词所在句（前 0.3 秒 ~ 后 1.2 秒，最长 12 秒）
function segRange(m: { startTime: number; endTime: number }) {
  const s = Math.max(0, m.startTime - 0.3);
  const e = Math.min(m.endTime + 1.2, s + 12);
  return { s, e };
}

const PLAN_OPTIONS = [5, 10, 15, 20, 30];

export default function Study() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const planMode = params.get('plan') === '1';

  const [books, setBooks] = useState<WordBook[]>([]);
  const [bookId, setBookId] = useState('');
  const [words, setWords] = useState<StudyWord[]>([]);
  const [index, setIndex] = useState(0);
  const [dailyCount, setDailyCount] = useState(10);
  const [learned, setLearned] = useState(0);
  const [videoOk, setVideoOk] = useState(true); // 视频加载失败时回退到音频
  const [vidPlaying, setVidPlaying] = useState(false); // 视频是否在播（控制 ▶ 提示角标）
  const videoRef = useRef<HTMLVideoElement>(null);
  const chainSeq = useRef(0); // 自动朗读链的序号：换词/手动操作后 +1，旧链的回调作废
  const clipRef = useRef<HTMLAudioElement | null>(null); // 自动播放的原声片段（切词时暂停）
  const [browse, setBrowse] = useState(false); // 双击词书选择框 → 单词浏览面板
  const [browseFilter, setBrowseFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 词书列表
  useEffect(() => {
    api.books()
      .then((bs) => {
        setBooks(bs);
        // 自动选第一本有单词的词书
        const first = bs.find((b) => (b._count?.words ?? 0) > 0);
        if (first) setBookId(first.id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // 切换词书后加载单词
  useEffect(() => {
    if (!bookId) return;
    setLoading(true);
    setError(null);
    api.bookWords(bookId)
      .then((ws) => {
        setWords(ws);
        setIndex(0);
        setLearned(0);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookId]);

  // 换词后重置视频状态（上一条视频若加载失败不影响新词）
  useEffect(() => {
    setVideoOk(true);
    setVidPlaying(false);
  }, [index]);

  // 词卡出现自动朗读：① 先读单词本身的发音 → ② 读完自动播视频/音频片段（含目标词那句）
  //    → ③ 都没有素材的词接着读例句（AI/书中例句）
  useEffect(() => {
    const w = words[index];
    if (!w) return;
    clipRef.current?.pause(); // 停掉上一个词的原声片段
    const seq = ++chainSeq.current;
    const m = pickMapping(w);
    const playMedia = () => {
      // 单词读完 → 播含目标词的视频/音频片段；无素材的词读例句
      if (seq !== chainSeq.current) return; // 已被切词/手动操作打断
      const vid = videoRef.current;
      if (m?.videoUrl && vid) {
        const { s } = segRange(m);
        vid.currentTime = s; // 绝对时间定位到本句开头（不能设 0，会跳回整集开头）
        vid.play().catch(() => {});
        // 2.5 秒后还没播起来（公网缓冲/被浏览器拦截/加载失败）→ 退回音频片段
        setTimeout(() => {
          if (seq !== chainSeq.current) return;
          if (vid.paused || vid.currentTime < s + 0.3) {
            vid.pause();
            if (m.audioUrl) clipRef.current = playClip(m.audioUrl);
          }
        }, 2500);
      } else if (m?.audioUrl) {
        clipRef.current = playClip(m.audioUrl);
      } else if (w.exampleKo) {
        speakKorean(w.exampleKo);
      }
    };
    if (w.audioUrl) {
      // ① 站内单词原声（全词表生成，所有设备一致）→ 读完链播视频/音频片段
      clipRef.current = playClip(w.audioUrl, playMedia);
    } else if (!speakKorean(w.hangul, playMedia)) playMedia(); // 无原声：TTS 或直接播片段
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const word: StudyWord | undefined = words[index];
  const done = planMode && learned >= dailyCount;

  // 认识/不认识：记录后自动进入下一词
  function mark(known: boolean) {
    if (!word) return;
    api.learn(word.id, known).catch(() => {});
    setLearned((n) => n + 1);
    if (index + 1 < words.length) setIndex((i) => i + 1);
  }

  return (
    <div className="wrap">
      <section className="study-head">
        <div className="mode-switch">
          <button className={!planMode ? 'chip on' : 'chip'} onClick={() => navigate('/study')}>
            📖 直接背诵
          </button>
          <button className={planMode ? 'chip on' : 'chip'} onClick={() => navigate('/study?plan=1')}>
            🎯 计划背诵
          </button>
        </div>
        <div className="study-controls">
          <select
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            onDoubleClick={() => setBrowse(true)}
            title="双击浏览单词书"
          >
            <option value="">选择词书…</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}（{b._count?.words ?? 0} 词）
              </option>
            ))}
          </select>
          {planMode && (
            <div className="plan-count">
              <span>每天背</span>
              {PLAN_OPTIONS.map((n) => (
                <button
                  key={n}
                  className={dailyCount === n ? 'chip on' : 'chip'}
                  onClick={() => setDailyCount(n)}
                >
                  {n}
                </button>
              ))}
              <span>个</span>
            </div>
          )}
        </div>
        {planMode && !done && (
          <div className="plan-progress">
            今日已学 <b>{learned}</b> / {dailyCount}
          </div>
        )}

        {/* 双击词书选择框 → 单词浏览面板 */}
        {browse && (
          <div className="book-browser">
            <div className="bb-head">
              <b>📚 {books.find((b) => b.id === bookId)?.name ?? '词书浏览'}</b>
              <input
                className="q-input"
                style={{ width: 220, padding: '8px 12px', fontSize: 14 }}
                placeholder="搜索单词/释义…"
                value={browseFilter}
                onChange={(e) => setBrowseFilter(e.target.value)}
              />
              <button className="fc-prev" onClick={() => { setBrowse(false); setBrowseFilter(''); }}>关闭</button>
            </div>
            <div className="bb-list">
              {words
                .filter((w) => w.hangul.includes(browseFilter) || w.meaningCn.includes(browseFilter))
                .map((w) => (
                  <div key={w.id} className="bb-item">
                    <b>{w.hangul}</b>
                    <span className="bb-mean">{w.meaningCn}</span>
                    <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>
                      {w.partOfSpeech ?? ''} {w.hanja ? `汉字：${w.hanja}` : ''}
                    </span>
                  </div>
                ))}
              {words.length === 0 && <p style={{ color: 'var(--ink-2)' }}>词书加载中或为空…</p>}
            </div>
          </div>
        )}
      </section>

      {error && <p style={{ color: '#c0392b' }}>加载失败：{error}</p>}
      {!bookId && !error && (
        <div className="placeholder-card">请选择一本词书开始背诵 📚</div>
      )}
      {loading && <p style={{ color: 'var(--ink-2)' }}>单词加载中…</p>}

      {word && !done && (
        <>
          {/* 直接显示卡片：韩语大字 → 释义+词性 → 例句（视频素材原句）→ 视频/音频 */}
          <div className="study-card">
            <div className="sc-head">
              <div className="fc-hangul">{word.hangul}</div>
              <button
                className="btn-tts"
                onClick={() => {
                  chainSeq.current++; // 打断自动链，只重读单词本身的发音
                  playWordAudio(word);
                }}
                title="播放单词发音"
              >
                🔊
              </button>
            </div>
            <div className="fc-meaning">{word.meaningCn}</div>
            <div className="sc-tags">
              {word.partOfSpeech && <span className="tag tag-blue">{word.partOfSpeech}</span>}
              {word.hanja && <span className="tag tag-pink">汉字：{word.hanja}</span>}
            </div>
            {(() => {
              const m = pickMapping(word);
              if (!m || (!m.videoUrl && !m.audioUrl)) {
                // 无视频/音频素材 → 显示文本例句（书中例句或 AI 生成）
                if (!word.exampleKo) return null;
                let hl = splitHighlight(word.exampleKo, word.hangul);
                if (!hl.match && word.hangul.endsWith('다')) {
                  hl = splitHighlight(word.exampleKo, word.hangul.slice(0, -1)); // 词形变化宽松匹配
                }
                return (
                  <div className="sc-context">
                    <div className="sc-quote">
                      “{hl.before}
                      <span className="hl">{hl.match || word.hangul}</span>
                      {hl.after}”
                    </div>
                    {word.exampleZh && (
                      <div style={{ color: 'var(--ink-2)', marginTop: 6 }}>💬 {word.exampleZh}</div>
                    )}
                    <div className="sc-src">
                      {word.exampleSource === 'ai' ? '🤖 AI 例句' : '📖 书中例句'}
                    </div>
                  </div>
                );
              }
              const hl = splitHighlight(m.quote, m.surface);
              return (
                <div className="sc-context">
                  <div className="sc-quote">
                    “{hl.before}
                    <span className="hl">{hl.match || word.hangul}</span>
                    {hl.after}”
                  </div>
                  {m.quoteZh && <div className="sc-quote-zh">💬 {m.quoteZh}</div>}
                  <div className="sc-src">
                    {m.sourceType === 'song' ? '🎵' : '📺'} {m.artist ? `${m.artist} · ` : ''}
                    {m.sourceName}
                    {!m.verified && <span style={{ marginLeft: 6, color: '#e67e22' }}>· 待校对</span>}
                  </div>
                  {m.videoUrl && videoOk ? (
                    <div className="vid-wrap">
                      {/* 无进度条、不可拖动：点击视频 = 从头重播本句 */}
                      <video
                        key={`${word.id}-${m.id}`}
                        ref={videoRef}
                        className="lyr-video"
                        src={`${m.videoUrl}#t=${Math.max(0, m.startTime - 0.3)},${m.endTime + 1.2}`}
                        playsInline
                        preload="metadata"
                        onClick={(ev) => {
                          chainSeq.current++; // 打断自动链
                          stopSpeaking();
                          clipRef.current?.pause();
                          const v = ev.currentTarget;
                          v.currentTime = segRange(m).s; // 绝对时间定位到本句开头
                          v.play().catch(() => {});
                        }}
                        onTimeUpdate={(ev) => {
                          // 禁止播到本句之外：越界立即拉回句首并暂停
                          const v = ev.currentTarget;
                          const { s, e } = segRange(m);
                          if (v.currentTime > e + 0.3 || v.currentTime < s - 0.3) {
                            v.currentTime = s;
                            v.pause();
                          }
                        }}
                        onPlay={() => setVidPlaying(true)}
                        onPause={() => setVidPlaying(false)}
                        onEnded={() => setVidPlaying(false)}
                        onError={() => setVideoOk(false)}
                      />
                      <div className="sub-overlay">
                        {hl.before}
                        <mark>{hl.match || word.hangul}</mark>
                        {hl.after}
                      </div>
                      {!vidPlaying && <div className="play-badge">▶ 点击播放 / 重播</div>}
                    </div>
                  ) : (
                    m.audioUrl && (
                      <button
                        className="btn-audio"
                        onClick={() => {
                          chainSeq.current++;
                          stopSpeaking();
                          const url = m.audioUrl;
                          if (url) playClip(url);
                        }}
                      >
                        ▶ 听原声句
                      </button>
                    )
                  )}
                  {m.audioUrl && videoOk && m.videoUrl && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="btn-audio"
                        onClick={() => {
                          chainSeq.current++;
                          stopSpeaking();
                          const url = m.audioUrl;
                          if (url) playClip(url);
                        }}
                      >
                        🔊 听原声（公网/弱网推荐）
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="fc-actions">
            <button className="fc-prev" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              ← 上一个
            </button>
            <button className="btn-wrong" onClick={() => mark(false)}>
              😅 不认识
            </button>
            <button className="btn-known" onClick={() => mark(true)}>
              😊 认识
            </button>
            <button
              className="fc-next"
              disabled={index >= words.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              下一个 →
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 14, color: 'var(--ink-2)', fontSize: 13 }}>
            {index + 1} / {words.length}
          </div>

          {/* 测试题入口：从全部已学单词出题 */}
          <div className="study-bottom">
            <Link to="/quiz">
              <button className="btn-known">✏️ 测试题（已学单词）</button>
            </Link>
            <Link to="/errors"><button className="fc-prev">📕 错词本</button></Link>
            <Link to="/review"><button className="fc-prev">🔁 复习</button></Link>
          </div>
        </>
      )}

      {done && (
        <div className="placeholder-card">
          <div className="big">🎉</div>
          <h1>今日背诵完成！</h1>
          <p style={{ marginBottom: 22 }}>已完成 {learned} 个单词，趁热打铁进入测试题巩固记忆</p>
          <Link to="/quiz">
            <button className="btn-main">✏️ 测试题（已学单词）</button>
          </Link>
        </div>
      )}
    </div>
  );
}
