import { ssoConfigured, ssoEnforced } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

// Server component: reads the SSO flags from server-side env (lib/auth) and hands
// the client form plain booleans — the Entra client id/secret never reach the client.
export default function LoginPage() {
  return <LoginForm ssoConfigured={ssoConfigured} ssoEnforced={ssoEnforced} />;
}
