import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { FeaturedMapping, LyricsSource } from '../types';

// 在歌词原句中定位目标词（surface 为句中实际形态），返回三部分用于高亮
function splitHighlight(quote: string, surface: string | null) {
  if (!surface) return { before: quote, match: '', after: '' };
  const idx = quote.indexOf(surface);
  if (idx < 0) return { before: quote, match: '', after: '' };
  return {
    before: quote.slice(0, idx),
    match: quote.slice(idx, idx + surface.length),
    after: quote.slice(idx + surface.length),
  };
}

// 片段起止：只含目标词所在句（前 0.3 秒 ~ 后 1.2 秒，最长 12 秒）
function segRange(m: FeaturedMapping) {
  const s = Math.max(0, m.startTime - 0.3);
  const e = Math.min(m.endTime + 1.2, s + 12);
  return { s, e };
}

// 原视频文件 URL（映射的 sourceName 即媒体文件名）
function videoUrl(m: FeaturedMapping): string | null {
  const folder = m.sourceType === 'song' ? 'songs' : 'going';
  const { s, e } = segRange(m);
  return `/media/${folder}/${encodeURIComponent(m.sourceName)}.mp4#t=${s},${e}`;
}

function playAudio(url: string) {
  const a = new Audio(url);
  a.play().catch(() => {});
}

type View = 'list' | 'learn';

export default function Lyrics() {
  const [params] = useSearchParams();
  const mixMode = params.get('mix') === '1';

  const [view, setView] = useState<View>(mixMode ? 'learn' : 'list');
  const [sources, setSources] = useState<LyricsSource[]>([]);
  const [curSource, setCurSource] = useState<string>('');
  const [items, setItems] = useState<FeaturedMapping[]>([]);
  const [index, setIndex] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [videoOk, setVideoOk] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 进入页面：混合 → 直接随机出词；否则加载歌曲列表
  useEffect(() => {
    if (mixMode) {
      startMixed();
    } else {
      setLoading(true);
      api.lyricsSources()
        .then((s) => setSources(s.filter((x) => x.sourceType === 'song')))
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 换词：重置视频状态并自动播放片段
  useEffect(() => {
    setVideoOk(true);
    const v = videoRef.current;
    const item = items[index];
    if (v && item) {
      const { s } = segRange(item);
      v.currentTime = s;
      v.play().catch(() => {});
    }
  }, [index, items, view]);

  // 点击空白处：从片段起点重播
  function replay() {
    const item = items[index];
    const v = videoRef.current;
    if (!item) return;
    if (videoOk && v) {
      const { s } = segRange(item);
      v.currentTime = s;
      v.play().catch(() => {});
    } else if (item.audioUrl) {
      playAudio(item.audioUrl);
    }
  }

  function startMixed() {
    setLoading(true);
    setError(null);
    api.lyricsMixed(20)
      .then((list) => {
        setItems(list);
        setIndex(0);
        setDoneCount(0);
        setCurSource('');
        setView('learn');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function openSource(name: string) {
    setLoading(true);
    setError(null);
    api.lyricsSourceWords(name)
      .then((list) => {
        setItems(list);
        setIndex(0);
        setDoneCount(0);
        setCurSource(name);
        setView('learn');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function answer(known: boolean) {
    const item = items[index];
    if (!item) return;
    api.learn(item.wordId, known).catch(() => {});
    setDoneCount((n) => n + 1);
    if (index + 1 < items.length) setIndex((i) => i + 1);
  }

  // ---------- 学习完成页 ----------
  if (view === 'learn' && items.length > 0 && index >= items.length) {
    return (
      <div className="wrap">
        <div className="placeholder-card">
          <div className="big">🎉</div>
          <h1>{curSource ? `《${curSource}》学完啦！` : '本轮随机学习完成！'}</h1>
          <p style={{ marginBottom: 22 }}>完成 {doneCount} 个歌词单词，已计入学习记录（进艾宾浩斯复习队列）</p>
          <div className="fc-actions">
            <Link to="/quiz">
              <button className="btn-known">✏️ 测试题（已学单词）</button>
            </Link>
            {curSource ? (
              <button className="fc-prev" onClick={() => openSource(curSource)}>🔄 再学一轮</button>
            ) : (
              <button className="fc-prev" onClick={startMixed}>🔄 再来一轮</button>
            )}
            <button className="fc-prev" onClick={() => setView('list')}>← 返回列表</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 学习页（词卡 + 视频片段） ----------
  if (view === 'learn' && items.length > 0 && items[index]) {
    const item = items[index];
    const hl = splitHighlight(item.quote, item.surface);
    return (
      <div className="wrap">
        <div className="quiz-head">
          <h2>{curSource ? `🎤 ${curSource}` : '🎲 混合随机学习'}</h2>
          <div className="quiz-progress">
            <div className="mini-bar" style={{ background: '#e6e9f7', height: 8, borderRadius: 4, overflow: 'hidden', flex: 1 }}>
              <i style={{ display: 'block', height: '100%', width: `${(index / items.length) * 100}%`, background: 'var(--grad)', borderRadius: 4 }}></i>
            </div>
            <span>{index + 1} / {items.length}</span>
          </div>
        </div>

        <div className="quiz-card" style={{ textAlign: 'center', cursor: 'pointer' }} onClick={replay}>
          {/* 单词 + 释义（先看释义） */}
          <div className="q-stem" style={{ marginBottom: 16 }}>
            <div className="q-word">{item.word.hangul}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{item.word.meaningCn}</div>
            <div>
              {item.word.partOfSpeech && <span className="tag tag-blue">{item.word.partOfSpeech}</span>}{' '}
              {item.word.hanja && <span className="tag tag-pink">汉字：{item.word.hanja}</span>}
            </div>
          </div>

          {/* 视频片段（只播目标词所在的那一句，不可拖动）；字幕显示原句并高亮目标词；加载失败退回音频 */}
          {videoOk ? (
            <div className="vid-wrap">
              <video
                key={item.id}
                ref={videoRef}
                className="lyr-video"
                src={videoUrl(item) ?? undefined}
                playsInline
                onError={() => setVideoOk(false)}
                onTimeUpdate={(ev) => {
                  // 禁止拖出本句范围：越界立即拉回起点并暂停
                  const v = ev.currentTarget;
                  const { s, e } = segRange(item);
                  if (v.currentTime > e + 0.3 || v.currentTime < s - 0.3) {
                    v.currentTime = s;
                    v.pause();
                  }
                }}
              />
              <div className="sub-overlay">
                {hl.before}
                <mark>{hl.match || item.word.hangul}</mark>
                {hl.after}
              </div>
            </div>
          ) : (
            item.audioUrl && (
              <button className="btn-tts" onClick={(e) => { e.stopPropagation(); playAudio(item.audioUrl!); }} title="播放原声片段">
                ▶
              </button>
            )
          )}
          {/* 公网/弱网下视频缓冲慢：随时可点原声直接听本句 */}
          {item.audioUrl && videoOk && (
            <div style={{ marginTop: 8 }}>
              <button
                className="btn-audio"
                onClick={(e) => {
                  e.stopPropagation();
                  playAudio(item.audioUrl!);
                }}
              >
                🔊 听原声
              </button>
            </div>
          )}
          <div className="q-sub" style={{ fontSize: 12, opacity: 0.75 }}>点击卡片重播本句 · 仅播放目标词所在句</div>

          {/* 歌词原句：目标词粉蓝高亮，其余黑色 */}
          <div className="lyr-quote">
            “{hl.before}
            <span className="hl">{hl.match || item.word.hangul}</span>
            {hl.after}”
          </div>
          {item.quoteZh && <div className="lyr-quote-zh">💬 {item.quoteZh}</div>}
          <div className="lyr-src">
            {item.sourceType === 'song' ? '🎵' : '📺'} {item.artist ? `${item.artist} · ` : ''}{item.sourceName}
          </div>
        </div>

        <div className="fc-actions">
          <button className="fc-prev" onClick={() => setView('list')}>← 返回</button>
          <button className="btn-wrong" onClick={() => answer(false)}>😅 不认识</button>
          <button className="btn-known" onClick={() => answer(true)}>😊 认识</button>
        </div>

        {/* 测试题板块：从全部已学单词出题 */}
        <div className="study-bottom">
          <Link to="/quiz">
            <button className="btn-known">✏️ 测试题（已学单词）</button>
          </Link>
          <Link to="/errors"><button className="fc-prev">📕 错词本</button></Link>
        </div>
      </div>
    );
  }

  // ---------- 列表页 ----------
  return (
    <div className="wrap">
      <div className="sec-head">
        <h2>GOING 歌词学习</h2>
        <span className="hint">先看释义 → 视频片段 → 歌词高亮 · 学的词计入复习队列</span>
      </div>

      {error && <p style={{ color: '#c0392b' }}>加载失败：{error}</p>}
      {loading && <p style={{ color: 'var(--ink-2)' }}>加载中…</p>}

      {/* 混合随机卡 */}
      <button className="lyr-mix-card" onClick={startMixed}>
        <div className="gc-icon" style={{ background: 'linear-gradient(135deg, #e4edff, #ffd2e7)' }}>🎲</div>
        <div style={{ textAlign: 'left', flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>混合随机学习</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
            歌曲 + GOING SEVENTEEN 混着随机出词，惊喜感拉满
          </div>
        </div>
        <div style={{ fontWeight: 700, color: 'var(--blue-deep)' }}>开始 →</div>
      </button>

      {/* 歌曲列表 */}
      <div className="grid-books" style={{ marginTop: 20 }}>
        {sources.map((s) => (
          <button key={s.sourceName} className="book lyr-book" onClick={() => openSource(s.sourceName)}>
            <span className="tag tag-blue">🎵 歌曲</span>
            <div className="name" style={{ fontSize: 16 }}>{s.sourceName}</div>
            <div className="meta">覆盖 {s.wordCount} 个词 · {s.artist ?? 'SEVENTEEN'}</div>
            <div className="prog"><i style={{ width: '100%' }}></i></div>
            <div className="prog-text">点击开始学习 →</div>
          </button>
        ))}
        {sources.length === 0 && !loading && !error && (
          <p style={{ color: 'var(--ink-2)' }}>还没有歌曲素材，去 media\songs 放入歌曲后运行流水线 🎵</p>
        )}
      </div>
    </div>
  );
}
