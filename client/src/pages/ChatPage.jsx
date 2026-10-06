import { useEffect, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import ChatWindow from '../components/ChatWindow.jsx';
import InfoPanel from '../components/InfoPanel.jsx';
import NewChatModal from '../components/NewChatModal.jsx';
import Sidebar from '../components/Sidebar.jsx';
import { useAuth } from '../store/auth.js';
import { useChat } from '../store/chat.js';

export default function ChatPage() {
  const navigate = useNavigate();
  const conversationId = useMatch('/c/:conversationId')?.params.conversationId ?? null;
  const user = useAuth((state) => state.user);
  const [infoOpen, setInfoOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);

  // The realtime connection lives exactly as long as this page.
  useEffect(() => {
    useChat.getState().start(user);
    return () => useChat.getState().stop();
  }, [user]);

  useEffect(() => {
    useChat.getState().setActive(conversationId);
    setInfoOpen(false);
  }, [conversationId]);

  // The open conversation disappeared (removed from it, it was deleted, or the
  // URL never pointed at one of ours): go back to the list.
  const missing = useChat(
    (state) => Boolean(conversationId) && state.listLoaded && !state.conversations[conversationId],
  );
  useEffect(() => {
    if (missing) navigate('/', { replace: true });
  }, [missing, navigate]);

  // Coming back to the tab is when unread messages become read.
  useEffect(() => {
    const onAttention = () => useChat.getState().markActiveRead();
    window.addEventListener('focus', onAttention);
    document.addEventListener('visibilitychange', onAttention);
    return () => {
      window.removeEventListener('focus', onAttention);
      document.removeEventListener('visibilitychange', onAttention);
    };
  }, []);

  const conversation = useChat((state) => (conversationId ? state.conversations[conversationId] : null));
  const open = (id) => navigate(`/c/${id}`);

  return (
    <div className="flex h-dvh overflow-hidden bg-white dark:bg-slate-900">
      {/* Phone: the list and the chat are separate screens. Tablet and up: side by side. */}
      <div
        className={`${conversationId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 md:w-80 lg:w-96`}
      >
        <Sidebar activeId={conversationId} onSelect={open} onNewChat={() => setNewChatOpen(true)} />
      </div>

      <main className={`${conversationId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {conversation ? (
          <ChatWindow
            key={conversation.id}
            conversation={conversation}
            onBack={() => navigate('/')}
            onToggleInfo={() => setInfoOpen((current) => !current)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center dark:bg-slate-950">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
              <MessagesSquare className="h-8 w-8" />
            </span>
            <h2 className="text-lg font-semibold">Your messages</h2>
            <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
              Pick a conversation from the list, or start a new one.
            </p>
            <button type="button" className="btn-primary mt-2" onClick={() => setNewChatOpen(true)}>
              New conversation
            </button>
          </div>
        )}
      </main>

      {conversation && infoOpen && (
        <InfoPanel conversation={conversation} onClose={() => setInfoOpen(false)} />
      )}

      {newChatOpen && (
        <NewChatModal
          onClose={() => setNewChatOpen(false)}
          onOpened={(id) => {
            setNewChatOpen(false);
            open(id);
          }}
        />
      )}
    </div>
  );
}
