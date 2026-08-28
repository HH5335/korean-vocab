import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AdminStats } from '../types';

// 时间格式化：注册时间用年月日，登录时间精确到分钟
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN');
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function Admin() {
  const [data, setData] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.adminStats().then(setData).catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  if (error) return <div className="wrap"><p style={{ color: '#c0392b' }}>加载失败：{error}</p></div>;
  if (!data) return <div className="wrap"><p style={{ color: 'var(--ink-2)' }}>加载中…</p></div>;

  const maxDaily = Math.max(1, ...data.dailyActive.map((d) => d.activeUsers));

  return (
    <div className="wrap">
      <div className="sec-head">
        <h2>🛠️ 管理后台</h2>
        <span className="hint">注册用户 · 最近登录 · 每日活跃</span>
        <button className="btn-refresh" onClick={load}>刷新</button>
      </div>

      <div className="grid-stats">
        {/* 注册用户 */}
        <div className="panel">
          <h3>👥 注册用户（{data.users.length} 人）</h3>
          <div className="sub">按注册时间排序</div>
          <div className="admin-table">
            <div className="admin-row admin-head">
              <span>用户名</span><span>注册时间</span><span>登录会话</span><span>今日活跃</span>
            </div>
            {data.users.map((u) => (
              <div key={u.username} className="admin-row">
                <span>{u.username}{u.isAdmin ? ' 🛠️' : ''}</span>
                <span>{fmtDate(u.createdAt)}</span>
                <span>{u.sessionsEver}</span>
                <span>{u.activeToday ? '✅' : '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 最近登录 */}
        <div className="panel">
          <h3>🔑 最近登录</h3>
          <div className="sub">会话建立时间（30 天免登录）</div>
          <div className="week-list">
            {data.recentLogins.length === 0 && (
              <div className="week-item"><span className="k">暂无记录</span></div>
            )}
            {data.recentLogins.map((l, i) => (
              <div key={i} className="week-item">
                <span className="k">{fmtTime(l.createdAt)}</span>
                <span className="v">{l.username}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 每日活跃 */}
        <div className="panel">
          <h3>📅 每日活跃（近 14 天）</h3>
          <div className="sub">当天有学习记录的去重用户数</div>
          <div className="week-list">
            {[...data.dailyActive].reverse().map((d) => (
              <div key={d.date} className="week-item" style={{ flexDirection: 'column', gap: 6, marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span className="k">{d.date.slice(5)}</span>
                  <span className="v">{d.activeUsers} 人</span>
                </div>
                <div className="mini-bar" style={{ background: '#eef1fb', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                  <i
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${Math.round((d.activeUsers / maxDaily) * 100)}%`,
                      background: 'var(--grad)',
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
