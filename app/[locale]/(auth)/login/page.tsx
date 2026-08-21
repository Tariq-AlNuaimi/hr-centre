import { LoginForm } from "./LoginForm";

// Server component. SSO was removed on 2026-08-21 (audit A1), so there are no
// server-derived provider flags left to pass down; the form is credentials-only.
export default function LoginPage() {
  return <LoginForm />;
}
