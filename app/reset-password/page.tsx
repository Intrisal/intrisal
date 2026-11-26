import { AuthPageShell } from "@/components/landing/AuthPageShell";
import { ResetPasswordForm } from "@/components/landing/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <AuthPageShell title="Reset password" showBack>
      <ResetPasswordForm />
    </AuthPageShell>
  );
}
