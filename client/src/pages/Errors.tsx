import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { playWordAudio } from '../audio';
import type { ErrorItem } from '../types';

export default function Errors() {
  const [items, setItems] = useState<ErrorItem[]>([]);
  const [studyMode, setStudyMode] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.errorWords()
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

  // 错词本背诵：答对 → 移出错词本（后端处理），答错 → 停留并计数
  function mark(known: boolean) {
    if (!item) return;
    api.learn(item.wordId, known).catch(() => {});
    if (known) {
      const rest = items.filter((it) => it.id !== item.id);
      setItems(rest);
      if (index >= rest.length) setIndex(Math.max(0, rest.length - 1));
    }
    setFlipped(false);
  }

  if (loading) return <div className="wrap"><p style={{ color: 'var(--ink-2)' }}>加载错词本…</p></div>;
  if (error) return <div className="wrap"><p style={{ color: '#c0392b' }}>加载失败：{error}</p></div>;

  // 错词本背诵模式
  if (studyMode && items.length > 0 && item) {
    return (
      <div className="wrap">
        <section className="study-head">
          <h2>📕 错词本背诵</h2>
          <div className="plan-progress">
            剩余 <b>{items.length}</b> 个 · 答对移出错词本
          </div>
        </section>

        <div className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(!flipped)}>
          <div className="flashcard-inner">
            <div className="flashcard-face flashcard-front">
              <div className="fc-hangul">{item.word.hangul}</div>
              <button className="btn-tts" onClick={(e) => { e.stopPropagation(); playWordAudio(item.word); }}>🔊</button>
              <div className="fc-hint">错 {item.errorCount} 次 · 点击卡片查看释义</div>
            </div>
            <div className="flashcard-face flashcard-back">
              <div className="fc-meaning">{item.word.meaningCn}</div>
              <div>
                {item.word.partOfSpeech && <span className="tag tag-blue">{item.word.partOfSpeech}</span>}{' '}
                {item.word.hanja && <span className="tag tag-pink">汉字：{item.word.hanja}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="fc-actions">
          <button className="btn-wrong" onClick={() => mark(false)}>😅 还是不会</button>
          <button className="btn-known" onClick={() => mark(true)}>😊 记住了！</button>
          <button className="fc-prev" onClick={() => setStudyMode(false)}>返回列表</button>
        </div>
      </div>
    );
  }

  if (studyMode && items.length === 0) {
    return (
      <div className="wrap">
        <div className="placeholder-card">
          <div className="big">🎉</div>
          <h1>错词本清空啦！</h1>
          <p style={{ marginBottom: 22 }}>所有错词都已掌握，최고예요! 👏</p>
          <div className="fc-actions">
            <Link to="/study"><button className="btn-known">📖 继续背新单词</button></Link>
          </div>
        </div>
      </div>
    );
  }

  // 错词本列表
  return (
    <div className="wrap">
      <section className="study-head">
        <h2>📕 错词本</h2>
        <span className="hint">检测中答错的单词会自动收集到这里</span>
        <div style={{ marginTop: 12 }}>
          <button className="btn-known" onClick={() => setStudyMode(true)} disabled={items.length === 0}>
            ▶ 开始背诵错词本（{items.length}）
          </button>
        </div>
      </section>

      {items.length === 0 ? (
        <div className="placeholder-card">
          <div className="big">✨</div>
          <h1>错词本是空的</h1>
          <p>去检测页做几道题，答错的词会出现在这里</p>
        </div>
      ) : (
        <div className="grid-books">
          {items.map((it) => (
            <div key={it.id} className="book" style={{ cursor: 'default' }}>
              <span className="tag tag-pink">错 {it.errorCount} 次</span>
              <div className="name" style={{ fontSize: 19 }}>{it.word.hangul}</div>
              <div className="meta">{it.word.meaningCn}{it.word.hanja ? `（${it.word.hanja}）` : ''}</div>
              <div className="meta" style={{ marginBottom: 0 }}>
                最近答错：{new Date(it.lastErrorAt).toLocaleDateString('zh-CN')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
