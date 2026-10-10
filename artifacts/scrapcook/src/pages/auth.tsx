import { SignIn, SignUp } from "@clerk/react";
import { basePath } from "@/lib/billing";

function target() {
  const p = new URLSearchParams(window.location.search);
  const r = p.get("redirect") ?? "";
  const ok = r.startsWith(`${basePath}/`) && !r.startsWith("//") && !r.includes("://");
  return { dest: ok ? r : `${basePath}/`, email: p.get("email") ?? "" };
}
const shell = { display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--sc-soft)" } as const;

export function SignInPage() {
  const { dest, email } = target();
  return (
    <div style={shell}>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up?redirect=${encodeURIComponent(dest)}`}
        forceRedirectUrl={dest} initialValues={email ? { emailAddress: email } : undefined} />
    </div>
  );
}
export function SignUpPage() {
  const { dest } = target();
  return (
    <div style={shell}>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in?redirect=${encodeURIComponent(dest)}`} forceRedirectUrl={dest} />
    </div>
  );
}
