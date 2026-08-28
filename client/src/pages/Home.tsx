import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Overview } from '../types';

// 热力图示例数据（确定性伪随机）
const heatCells = Array.from({ length: 105 }, (_, i) => {
  const r = (i * 37 + 11) % 100;
  const levels = ['#e9eefb', '#d5e2ff', '#b3ccff', '#8fb0ff', '#6f95f7', '#c98ae8', '#ff9ecb'];
  const lvl = r < 30 ? 0 : r < 48 ? 1 : r < 62 ? 2 : r < 74 ? 3 : r < 85 ? 4 : r < 93 ? 5 : 6;
  return levels[lvl];
});

export default function Home() {
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    api.overview()
      .then(setOverview)
      .catch((e: Error) => console.error('加载概览失败:', e.message));
  }, []);

  return (
    <div className="wrap">
      {/* Hero */}
      <section className="hero">
        <div className="diamond d1"></div>
        <div className="diamond d2"></div>
        <div className="diamond d3"></div>
        <span className="sparkle s1">✦</span>
        <span className="sparkle s2">✦</span>
        <span className="sparkle s3">✧</span>
        <div>
          <div className="hello">안녕하세요! 👋 오늘도 화이팅!</div>
          <h1>今天也一起背单词吧</h1>
          <div className="sub">延世 · TOPIK 词书 × SEVENTEEN 歌词语境，让单词住进耳朵里 💙💗</div>
          <div className="cta-row">
            <Link to="/study"><button className="btn-main">▶ 开始今日学习</button></Link>
            <Link to="/lyrics"><button className="btn-ghost">💎 GOING 歌词学习</button></Link>
          </div>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <div className="label">今日进度</div>
            <div className="value">{overview?.todayLearned ?? 0} <small>/ {overview?.todayGoal ?? 20} 词</small></div>
            <div className="mini-bar">
              <i style={{ width: `${Math.min(100, ((overview?.todayLearned ?? 0) / (overview?.todayGoal ?? 20)) * 100)}%` }}></i>
            </div>
          </div>
          <div className="stat-card">
            <div className="label">连续打卡</div>
            <div className="value">{overview?.streak ?? 0} <small>天 🔥</small></div>
          </div>
          <Link to="/review" className="stat-card">
            <div className="label">待复习</div>
            <div className="value">{overview?.dueCount ?? 0} <small>词</small></div>
          </Link>
          <Link to="/errors" className="stat-card">
            <div className="label">错词本</div>
            <div className="value">{overview?.errorCount ?? 0} <small>词 📕</small></div>
          </Link>
        </div>
      </section>

      {/* 学习模式 */}
      <section className="section">
        <div className="sec-head">
          <h2>🎮 学习模式</h2>
          <span className="hint">直接背 · 每日计划 · 词汇量检测</span>
        </div>
        <div className="grid-modes">
          <Link to="/study" className="mode">
            <div className="icon">📖</div>
            <h3>直接背诵</h3>
            <p>打开词书直接进入闪卡模式：翻面、发音、释义、歌词语境，随到随背。</p>
            <div className="go">进入闪卡模式 →</div>
          </Link>
          <Link to="/study?plan=1" className="mode">
            <div className="icon">🎯</div>
            <h3>每日计划 + 检测</h3>
            <p>设定每天背 N 个词 → 背完自动进入四种题型检测，答对弹夸奖表情包，答错进入错词本和复习队列。</p>
            <div className="go">设定今日计划 →</div>
          </Link>
          <Link to="/vocab-test" className="mode">
            <div className="icon">🧪</div>
            <h3>词汇量检测<span className="new">NEW</span></h3>
            <p>3 分钟随机抽样估算：按 TOPIK 词频分层出词，估算总词汇量并对照 TOPIK 等级。</p>
            <div className="go">开始测试 →</div>
          </Link>
        </div>
      </section>

      {/* 歌词学习 */}
      <section className="section">
        <div className="sec-head">
          <h2>GOING 歌词学习</h2>
          <span className="hint">SEVENTEEN 的歌 × GOING SEVENTEEN · CARAT 💎 边听边背</span>
        </div>
        <div className="going-cards">
          <Link to="/lyrics?song=1" className="going-card gc-blue">
            <div className="gc-diamond"></div>
            <div className="gc-icon">🎤</div>
            <h3>按歌曲学习</h3>
            <p>从歌曲列表选一首 → 随机词卡：先显示释义，再播放对应那句歌词原声，目标单词粉蓝高亮。</p>
            <div className="go">进入歌曲列表 →</div>
          </Link>
          <Link to="/lyrics?mix=1" className="going-card gc-pink">
            <div className="gc-diamond"></div>
            <div className="gc-icon">🎲</div>
            <h3>混合随机学习 <span className="tag tag-pink">歌曲 + GOING SEVENTEEN</span></h3>
            <p>歌和综艺混着随机出词，综艺词卡直接播放成员们的原声片段。</p>
            <div className="go">开始随机学习 →</div>
          </Link>
        </div>
      </section>

      {/* 统计区 */}
      <section className="section">
        <div className="sec-head">
          <h2>📈 我的学习足迹</h2>
          <span className="hint">打卡热力图 · 记忆保持率 · 本周小结</span>
        </div>
        <div className="grid-stats">
          <div className="panel">
            <h3>🔥 每日打卡</h3>
            <div className="sub">最近 15 周 · 颜色越深学习越多</div>
            <div className="heatmap">
              {heatCells.map((c, i) => (
                <div key={i} className="cell" style={{ background: c }}></div>
              ))}
            </div>
            <div className="legend">
              少 <i style={{ background: '#e9eefb' }}></i><i style={{ background: '#b3ccff' }}></i><i style={{ background: '#6f95f7' }}></i><i style={{ background: '#ff9ecb' }}></i> 多
            </div>
          </div>
          <div className="panel">
            <h3>🧠 记忆保持率</h3>
            <div className="sub">艾宾浩斯复习让曲线变平缓（示例）</div>
            <div className="curve-wrap">
              <svg width="100%" height="150" viewBox="0 0 300 150" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="curveGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#5B8DFF" /><stop offset="100%" stopColor="#FF8FC7" />
                  </linearGradient>
                </defs>
                <polyline
                  points="0,30 30,78 60,96 90,104 120,60 150,88 180,97 210,55 240,84 270,93 300,50"
                  fill="none" stroke="url(#curveGrad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                />
                <polyline
                  points="0,30 30,72 60,88 90,98 120,98 150,104 180,104 210,104 240,104 270,104 300,104"
                  fill="none" stroke="#d5deee" strokeWidth="2" strokeDasharray="5 5"
                />
              </svg>
            </div>
            <div className="legend" style={{ marginTop: 4 }}>🟦 有复习计划 · ⬜ 无复习（遗忘快）</div>
          </div>
          <div className="panel">
            <h3>📝 本周小结</h3>
            <div className="sub">还没有学习记录，开始第一课吧！</div>
            <div className="week-list">
              <div className="week-item"><span className="k">新学单词</span><span className="v">0 词</span></div>
              <div className="week-item"><span className="k">复习次数</span><span className="v">0 次</span></div>
              <div className="week-item"><span className="k">检测正确率</span><span className="v">—</span></div>
              <div className="week-item"><span className="k">活跃天数</span><span className="v">0 / 7 天</span></div>
              <div className="week-item"><span className="k">错词本</span><span className="v">{overview?.errorCount ?? 0} 词</span></div>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <span style={{ display: 'inline-flex', gap: 4, marginRight: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block' }}></span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pink)', display: 'inline-block' }}></span>
        </span>
        觉等死了再睡 · v0.3 · CARAT 💎 SEVENTEEN ✨
      </footer>
    </div>
  );
}
