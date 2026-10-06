import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Toaster from './components/Toaster.jsx';
import ChatPage from './pages/ChatPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import { AuthStatus, useAuth } from './store/auth.js';

export default function App() {
  const status = useAuth((state) => state.status);

  useEffect(() => {
    useAuth.getState().bootstrap();
  }, []);

  if (status === AuthStatus.LOADING) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
      </div>
    );
  }

  const signedIn = status === AuthStatus.AUTHENTICATED;
  const guestOnly = (page) => (signedIn ? <Navigate to="/" replace /> : page);

  return (
    <>
      <Routes>
        <Route path="/login" element={guestOnly(<LoginPage />)} />
        <Route path="/signup" element={guestOnly(<SignupPage />)} />
        {/* One route for "/" and "/c/:id", so opening a chat does not remount the page. */}
        <Route path="/*" element={signedIn ? <ChatPage /> : <Navigate to="/login" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
