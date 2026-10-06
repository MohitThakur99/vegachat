import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthLayout, { FormError } from '../components/AuthLayout.jsx';
import { useAuth } from '../store/auth.js';

// The accounts created by the seed script (server/src/db/seed.js).
const DEMO_PASSWORD = 'Password123!';
const DEMO_ACCOUNTS = ['rahul', 'priya', 'arjun', 'sneha', 'vikram', 'ananya'];

export default function LoginPage() {
  const login = useAuth((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(credentials) {
    setError(null);
    setSubmitting(true);
    try {
      await login(credentials);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue your conversations."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Create an account
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ email, password });
        }}
      >
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            className="input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <FormError error={error} />
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Demo accounts
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((name) => (
            <button
              key={name}
              type="button"
              disabled={submitting}
              onClick={() => submit({ email: `${name}@example.com`, password: DEMO_PASSWORD })}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium capitalize text-slate-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
