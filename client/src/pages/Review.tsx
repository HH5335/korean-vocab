import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { playWordAudio } from '../audio';
import type { ReviewItem } from '../types';

export default function Review() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.dueReviews()
      .then((list) => {
        setItems(list);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const item = items[index];
  const finished = items.length > 0 && doneCount >= items.length;

  function mark(known: boolean) {
    if (!item) return;
    api.learn(item.wordId, known).catch(() => {});
    setFlipped(false);
    setDoneCount((n) => n + 1);
    if (index + 1 < items.length) setIndex((i) => i + 1);
  }

  if (loading) return <div className="wrap"><p style={{ color: 'var(--ink-2)' }}>加载复习队列…</p></div>;
  if (error) return <div className="wrap"><p style={{ color: '#c0392b' }}>加载失败：{error}</p></div>;

  if (finished || items.length === 0) {
    return (
      <div className="wrap">
        <div className="placeholder-card">
          <div className="big">🎉</div>
          <h1>{items.length === 0 ? '今天没有需要复习的单词' : '复习完成！'}</h1>
          <p style={{ marginBottom: 22 }}>
            {items.length === 0
              ? '艾宾浩斯队列已清空，去学新单词吧～'
              : `完成 ${doneCount} 个单词的复习，记忆更牢固了！`}
          </p>
          <div className="fc-actions">
            <Link to="/study"><button className="btn-known">📖 去背新单词</button></Link>
            <Link to="/"><button className="fc-prev">🏠 回首页</button></Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <section className="study-head">
        <h2>🔁 今日复习</h2>
        <div className="plan-progress">
          待复习 <b>{items.length - doneCount}</b> / {items.length} · 已复习 <b>{doneCount}</b>
        </div>
      </section>

      <div className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(!flipped)}>
        <div className="flashcard-inner">
          <div className="flashcard-face flashcard-front">
            <div className="fc-hangul">{item.word.hangul}</div>
            <button className="btn-tts" onClick={(e) => { e.stopPropagation(); playWordAudio(item.word); }}>🔊</button>
            <div className="fc-hint">
              已复习 {item.reps} 次 · 阶段 {item.stage} · 点击卡片查看释义
            </div>
          </div>
          <div className="flashcard-face flashcard-back">
            <div className="fc-meaning">{item.word.meaningCn}</div>
            <div>
              {item.word.partOfSpeech && <span className="tag tag-blue">{item.word.partOfSpeech}</span>}{' '}
              {item.word.hanja && <span className="tag tag-pink">汉字：{item.word.hanja}</span>}
            </div>
            {item.word.mediaMappings.length > 0 && (
              <div className="fc-mappings">
                {item.word.mediaMappings.slice(0, 1).map((m) => (
                  <div key={m.id} className="fc-map">
                    <div className="fc-quote">“{m.quote}”</div>
                    <div className="fc-src">
                      {m.sourceType === 'song' ? '🎵' : '📺'} {m.artist ? `${m.artist} ` : ''}{m.sourceName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fc-actions">
        <button className="btn-wrong" onClick={() => mark(false)}>😅 忘了</button>
        <button className="btn-known" onClick={() => mark(true)}>😊 记得</button>
      </div>
    </div>
  );
}
