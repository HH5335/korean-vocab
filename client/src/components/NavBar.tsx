import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import SurveyInviteModal from './SurveyInviteModal';

// 退出登录时邀请填写的问卷星反馈问卷链接
const SURVEY_URL = 'https://v.wjx.cn/vm/PqT1G17.aspx#';
const SURVEY_ASKED_KEY = 'korean-vocab-survey-asked'; // 每浏览器只问一次

const baseLinks = [
  { to: '/', label: '首页' },
  { to: '/study', label: '背诵' },
  { to: '/review', label: '复习' },
  { to: '/errors', label: '错词本' },
  { to: '/lyrics', label: 'GOING 💎' },
  { to: '/vocab-test', label: '词汇量测试' },
  { to: '/stats', label: '统计' },
];

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showSurvey, setShowSurvey] = useState(false);
  const links = user?.isAdmin ? [...baseLinks, { to: '/admin', label: '🛠️ 管理' }] : baseLinks;

  const doLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleLogoutClick = () => {
    if (localStorage.getItem(SURVEY_ASKED_KEY)) {
      doLogout();
      return;
    }
    setShowSurvey(true);
  };

  return (
    <nav className="nav">
      <Link to="/" className="logo">
        <span className="dots"><span></span><span></span></span>
        觉等死了再睡 <small>한글단어</small>
      </Link>
      <div className="nav-links">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </div>
      {user ? (
        <div className="nav-user">
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
          <span className="uname">{user.username}</span>
          <button className="btn-logout" onClick={handleLogoutClick}>
            退出登录
          </button>
        </div>
      ) : (
        <div className="avatar">😊</div>
      )}
      {showSurvey && (
        <SurveyInviteModal
          onAgree={() => {
            window.open(SURVEY_URL, '_blank', 'noopener');
            localStorage.setItem(SURVEY_ASKED_KEY, '1');
            doLogout();
          }}
          onDecline={() => {
            localStorage.setItem(SURVEY_ASKED_KEY, '1');
            doLogout();
          }}
          onCancel={() => setShowSurvey(false)}
        />
      )}
    </nav>
  );
}
