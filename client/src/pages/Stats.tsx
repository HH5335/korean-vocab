import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { StatsDetail } from '../types';

// 热力图颜色：按每日学习次数深浅
function heatColor(count: number): string {
  if (count <= 0) return '#e9eefb';
  if (count < 3) return '#d5e2ff';
  if (count < 6) return '#b3ccff';
  if (count < 10) return '#8fb0ff';
  if (count < 15) return '#6f95f7';
  return '#ff9ecb';
}

// 复习阶段标签
const STAGE_LABEL: Record<number, string> = {
  0: '刚答错（当天复习）',
  1: '1 天后',
  2: '2 天后',
  3: '4 天后',
  4: '7 天后',
  5: '15 天后（已掌握）',
};

const localKey = (d: Date) => d.toLocaleDateString('sv-SE');

export default function Stats() {
  const [data, setData] = useState<StatsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.statsDetail().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  // 最近 105 天的热力图格子（从旧到新）
  const heatCells = useMemo(() => {
    if (!data) return [];
    const cells: { key: string; color: string; title: string }[] = [];
    const now = new Date();
    for (let i = 104; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = localKey(d);
      const count = data.dayCounts[key] ?? 0;
      cells.push({
        key,
        color: heatColor(count),
        title: `${key} · ${count} 次学习`,
      });
    }
    return cells;
  }, [data]);

  if (error) return <div className="wrap"><p style={{ color: '#c0392b' }}>加载失败：{error}</p></div>;
  if (!data) return <div className="wrap"><p style={{ color: 'var(--ink-2)' }}>加载统计中…</p></div>;

  const totalAnswered = data.totalCorrect + data.totalWrong;
  const accuracy = totalAnswered > 0 ? Math.round((data.totalCorrect / totalAnswered) * 100) : 0;
  const maxStage = Math.max(1, ...Object.keys(data.stageDist).map(Number), 5);

  return (
    <div className="wrap">
      <div className="sec-head">
        <h2>📈 学习统计</h2>
        <span className="hint">数据实时来自你的学习记录</span>
      </div>

      <div className="grid-stats">
        {/* 热力图 */}
        <div className="panel">
          <h3>🔥 每日打卡</h3>
          <div className="sub">最近 15 周 · 颜色越深学习越多</div>
          <div className="heatmap">
            {heatCells.map((c) => (
              <div key={c.key} className="cell" style={{ background: c.color }} title={c.title}></div>
            ))}
          </div>
          <div className="legend">
            少 <i style={{ background: '#e9eefb' }}></i><i style={{ background: '#b3ccff' }}></i><i style={{ background: '#6f95f7' }}></i><i style={{ background: '#ff9ecb' }}></i> 多
          </div>
        </div>

        {/* 数据面板 */}
        <div className="panel">
          <h3>📊 学习数据</h3>
          <div className="sub">累计统计</div>
          <div className="week-list">
            <div className="week-item"><span className="k">已学单词</span><span className="v">{data.learned} 词</span></div>
            <div className="week-item"><span className="k">已掌握（15 天+）</span><span className="v">{data.mastered} 词</span></div>
            <div className="week-item"><span className="k">总复习次数</span><span className="v">{data.totalReps} 次</span></div>
            <div className="week-item"><span className="k">答对 / 答错</span><span className="v">{data.totalCorrect} / {data.totalWrong}</span></div>
            <div className="week-item"><span className="k">检测正确率</span><span className="v">{accuracy}% {accuracy >= 80 ? '🎉' : ''}</span></div>
            <div className="week-item"><span className="k">错词本现存</span><span className="v">{data.errors} 词</span></div>
          </div>
        </div>

        {/* 复习阶段分布 */}
        <div className="panel">
          <h3>🧠 记忆阶段分布</h3>
          <div className="sub">各复习阶段的单词数量</div>
          <div className="week-list">
            {Array.from({ length: Math.min(maxStage, 5) + 1 }, (_, s) => (
              <div key={s} className="week-item" style={{ flexDirection: 'column', gap: 6, marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span className="k">{STAGE_LABEL[s] ?? `阶段 ${s}`}</span>
                  <span className="v">{data.stageDist[s] ?? 0} 词</span>
                </div>
                <div className="mini-bar" style={{ background: '#eef1fb', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                  <i
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${Math.min(100, ((data.stageDist[s] ?? 0) / Math.max(1, data.learned)) * 100)}%`,
                      background: s === 0 ? 'var(--pink)' : 'var(--grad)',
                      borderRadius: 3,
                    }}
                  ></i>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
