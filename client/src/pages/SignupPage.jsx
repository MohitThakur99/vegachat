import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Limits } from '@shared/constants.js';
import AuthLayout, { FormError } from '../components/AuthLayout.jsx';
import { useAuth } from '../store/auth.js';

export default function SignupPage() {
  const signup = useAuth((state) => state.signup);
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const field = (name) => ({
    value: form[name],
    onChange: (event) => setForm((current) => ({ ...current, [name]: event.target.value })),
  });

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(form);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It takes less than a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label htmlFor="displayName" className="label">
            Name
          </label>
          <input
            id="displayName"
            autoComplete="name"
            required
            autoFocus
            minLength={Limits.DISPLAY_NAME_MIN}
            maxLength={Limits.DISPLAY_NAME_MAX}
            className="input"
            {...field('displayName')}
          />
        </div>
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" required className="input" {...field('email')} />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={Limits.PASSWORD_MIN}
            maxLength={Limits.PASSWORD_MAX}
            className="input"
            {...field('password')}
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            At least {Limits.PASSWORD_MIN} characters.
          </p>
        </div>
        <FormError error={error} />
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </button>
      </form>
    </AuthLayout>
  );
}
