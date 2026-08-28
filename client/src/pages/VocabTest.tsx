import { useEffect, useState } from 'react';
import { api } from '../api';
import type { VocabRecord, VocabSample } from '../types';

// 估算词汇量 → TOPIK 等级对照（粗略参考）
function levelOf(estimate: number): string {
  if (estimate < 800) return 'TOPIK 1 级（入门）';
  if (estimate < 1500) return 'TOPIK 2 级（初级）';
  if (estimate < 2500) return 'TOPIK 3 级（中级）';
  if (estimate < 3500) return 'TOPIK 4 级（中级）';
  if (estimate < 5000) return 'TOPIK 5 级（高级）';
  return 'TOPIK 6 级（高级）';
}

function messageOf(level: string): string {
  if (level.includes('1')) return '刚刚起步，一起 파이팅! 💪';
  if (level.includes('2')) return '初级水平，继续积累！📚';
  if (level.includes('3')) return '中级入门，渐入佳境！😊';
  if (level.includes('4')) return '中级水平，冲高级！🔥';
  return '대박! 高级水准，克拉认证！🏆';
}

type Phase = 'intro' | 'testing' | 'result';

export default function VocabTest() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [sample, setSample] = useState<VocabSample | null>(null);
  const [index, setIndex] = useState(0);
  const [known, setKnown] = useState(0);
  const [estimate, setEstimate] = useState(0);
  const [level, setLevel] = useState('');
  const [history, setHistory] = useState<VocabRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.vocabHistory().then(setHistory).catch(() => {});
  }, []);

  function start() {
    setLoading(true);
    setError(null);
    api.vocabSample()
      .then((s) => {
        setSample(s);
        setIndex(0);
        setKnown(0);
        setPhase('testing');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // 认识/不认识 → 下一题；答完计算估算值
  function answer(recall: boolean) {
    if (!sample) return;
    const nextKnown = known + (recall ? 1 : 0);
    if (index + 1 < sample.sample.length) {
      setKnown(nextKnown);
      setIndex((i) => i + 1);
      return;
    }
    const total = sample.sample.length;
    const est = Math.round((nextKnown / total) * sample.totalWords);
    const lv = levelOf(est);
    setKnown(nextKnown);
    setEstimate(est);
    setLevel(lv);
    setPhase('result');
    api.saveVocabTest(est, lv)
      .then((r) => setHistory((h) => [r, ...h]))
      .catch(() => {});
  }

  const word = sample?.sample[index];

  // ---------- 结果页 ----------
  if (phase === 'result') {
    return (
      <div className="wrap">
        <div className="placeholder-card">
          <div className="big">⭐</div>
          <h1>估算词汇量：{estimate} 词</h1>
          <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--blue-deep)', marginBottom: 6 }}>{level}</p>
          <p style={{ marginBottom: 24 }}>{messageOf(level)}</p>
          {sample && sample.totalWords < 500 && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 18 }}>
              ⚠️ 当前词库只有 {sample.totalWords} 词，估算仅供参考；词库扩充后会更准确
            </p>
          )}
          <div className="fc-actions">
            <button className="btn-known" onClick={start}>🔄 重新测试</button>
            <button className="fc-prev" onClick={() => setPhase('intro')}>返回</button>
          </div>

          {history.length > 0 && (
            <div className="wrong-review" style={{ marginTop: 28 }}>
              <h3>📜 历史记录</h3>
              <div className="wrong-list">
                {history.map((h) => (
                  <span key={h.id} className="wrong-item">
                    {new Date(h.createdAt).toLocaleDateString('zh-CN')} · {h.estimate} 词 · {h.toplevel}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- 介绍页 ----------
  if (phase === 'intro') {
    return (
      <div className="wrap">
        <div className="quiz-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🧪</div>
          <h2 style={{ fontSize: 24, marginBottom: 10 }}>词汇量检测</h2>
          <p style={{ color: 'var(--ink-2)', lineHeight: 1.8, marginBottom: 24 }}>
            从词库按 <b>词频分层</b>随机抽样出 30 个单词，
            <br />
            你只需诚实回答「认识」或「不认识」，
            <br />
            系统按比例估算你的总词汇量，并对照 TOPIK 等级。
          </p>
          {error && <p style={{ color: '#c0392b' }}>加载失败：{error}</p>}
          <button className="btn-main" onClick={start} disabled={loading}>
            {loading ? '正在抽样…' : '▶ 开始检测（约 2 分钟）'}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 测试页 ----------
  if (!word) return <div className="wrap"><p style={{ color: 'var(--ink-2)' }}>词库为空，无法检测</p></div>;

  return (
    <div className="wrap">
      <div className="quiz-head">
        <h2>🧪 词汇量检测</h2>
        <div className="quiz-progress">
          <div className="mini-bar" style={{ background: '#e6e9f7', height: 8, borderRadius: 4, overflow: 'hidden', flex: 1 }}>
            <i style={{ display: 'block', height: '100%', width: `${(index / sample!.sample.length) * 100}%`, background: 'var(--grad)', borderRadius: 4 }}></i>
          </div>
          <span>{index + 1} / {sample!.sample.length}</span>
        </div>
      </div>

      <div className="quiz-card" style={{ textAlign: 'center' }}>
        <div className="q-stem" style={{ marginBottom: 30 }}>
          <div className="q-label">你认识这个单词吗？（诚实作答哦）</div>
          <div className="q-word">{word.hangul}</div>
          {word.partOfSpeech && <span className="tag tag-blue">{word.partOfSpeech}</span>}
        </div>
        <div className="fc-actions">
          <button className="btn-wrong" onClick={() => answer(false)}>🤔 不认识</button>
          <button className="btn-known" onClick={() => answer(true)}>😊 认识</button>
        </div>
      </div>
    </div>
  );
}
