import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import NavBar from './components/NavBar';
import Home from './pages/Home';
import Login from './pages/Login';
import Study from './pages/Study';
import Quiz from './pages/Quiz';
import Review from './pages/Review';
import Errors from './pages/Errors';
import Lyrics from './pages/Lyrics';
import VocabTest from './pages/VocabTest';
import Stats from './pages/Stats';
import Admin from './pages/Admin';

/** 路由守卫：未登录跳转登录页，登录后回到原页面 */
function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="wrap">加载中…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <Outlet />;
}

/** 路由守卫：仅管理员可进入（真正安全边界在后端 requireAdmin） */
function RequireAdmin() {
  const { user, loading } = useAuth();
  if (loading) return <div className="wrap">加载中…</div>;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Home />} />
            <Route path="/study" element={<Study />} />
            <Route path="/quiz" element={<Quiz />} />
            <Route path="/review" element={<Review />} />
            <Route path="/errors" element={<Errors />} />
            <Route path="/lyrics" element={<Lyrics />} />
            <Route path="/vocab-test" element={<VocabTest />} />
            <Route path="/stats" element={<Stats />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<Admin />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
