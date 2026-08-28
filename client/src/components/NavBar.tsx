import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

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
  const links = user?.isAdmin ? [...baseLinks, { to: '/admin', label: '🛠️ 管理' }] : baseLinks;

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
          <button
            className="btn-logout"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            退出登录
          </button>
        </div>
      ) : (
        <div className="avatar">😊</div>
      )}
    </nav>
  );
}
