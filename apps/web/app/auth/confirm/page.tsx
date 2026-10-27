import { ConfirmButton } from './ConfirmButton';

const COPY: Record<string, { title: string; body: string; cta: string }> = {
  recovery: { title: 'Reset your password', body: 'Continue to choose a new password.', cta: 'Continue' },
  magiclink: { title: 'Sign in', body: 'Continue to sign in to Growlink Autosteer AI.', cta: 'Sign in' },
  email: { title: 'Confirm your email', body: 'Confirm your email to finish setting up your account.', cta: 'Confirm email' },
  signup: { title: 'Confirm your email', body: 'Confirm your email to finish setting up your account.', cta: 'Confirm email' },
};

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const sp = await searchParams;
  const c = COPY[sp.type ?? 'email'] ?? COPY.email;
  return (
    <div className="login-wrap">
      <div className="stack gap-150">
        <div className="row gap-100"><span className="brand-logo" aria-hidden="true" /><span className="labs-tag">LABS</span></div>
        <h1 className="gl-h1">{c.title}</h1>
        <p className="subtle">{c.body}</p>
      </div>
      <ConfirmButton tokenHash={sp.token_hash ?? ''} type={sp.type ?? 'email'} next={sp.next ?? (sp.type === 'recovery' ? '/reset-password' : '/')} cta={c.cta} />
    </div>
  );
}
