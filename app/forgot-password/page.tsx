import { AuthPageShell } from "@/components/landing/AuthPageShell";
import { ForgotPasswordForm } from "@/components/landing/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell title="Forgot password" showBack>
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
