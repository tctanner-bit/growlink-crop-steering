import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function ResetPasswordPage() {
  if (!(await currentUser())) redirect('/login');
  return (
    <div className="login-wrap">
      <div className="stack gap-150">
        <div className="row gap-100"><span className="brand-logo" aria-hidden="true" /><span className="labs-tag">LABS</span></div>
        <h1 className="gl-h1">Choose a new password</h1>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
