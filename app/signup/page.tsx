import { AuthPageShell } from "@/components/landing/AuthPageShell";
import { SignupForm } from "@/components/landing/SignupForm";

export default function SignupPage() {
  return (
    <AuthPageShell title="Create account" showBack>
      <SignupForm />
    </AuthPageShell>
  );
}
