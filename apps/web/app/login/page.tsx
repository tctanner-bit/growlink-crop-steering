import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { Heading } from '@/components/ui';
import { LoginForm } from '@/components/LoginForm';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return (
    <div className="login-wrap stack gap-300">
      <div className="stack gap-150">
        <div className="row gap-100"><span className="brand-logo" aria-hidden="true" /><span className="labs-tag">LABS</span></div>
        <Heading size="xlarge">Sign in</Heading>
        <span className="subtle">Rock Wool Crop Steering</span>
      </div>
      <LoginForm />
    </div>
  );
}
