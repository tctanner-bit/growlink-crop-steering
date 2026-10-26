import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { Heading } from '@/components/ak';
import { LoginForm } from '@/components/LoginForm';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return (
    <div className="login-wrap stack gap-300">
      <div className="stack gap-100">
        <Heading size="xlarge">Sign in</Heading>
        <span className="subtle">Growlink Rock Wool Crop Steering</span>
      </div>
      <LoginForm />
    </div>
  );
}
