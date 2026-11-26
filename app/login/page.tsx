import { AuthPageShell } from "@/components/landing/AuthPageShell";
import { LoginForm } from "@/components/landing/LoginForm";

export default function LoginPage() {
  return (
    <AuthPageShell title="Sign in" showBack>
      <LoginForm />
    </AuthPageShell>
  );
}
