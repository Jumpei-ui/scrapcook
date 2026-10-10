import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { CookingPot, LoaderCircle } from "lucide-react";
import { useBilling, basePath } from "@/lib/billing";

type State = "checking" | "welcome" | "unpaid" | "error" | "missing";

export default function SuccessPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { fetchStatus, refresh, signInUrl } = useBilling();
  const [, setLocation] = useLocation();
  const sessionId = new URLSearchParams(window.location.search).get("session_id");
  const [state, setState] = useState<State>(sessionId ? "checking" : "missing");

  useEffect(() => {
    if (!sessionId || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async (n: number) => {
      try {
        const s = await fetchStatus({ session_id: sessionId });
        if (cancelled) return;
        if (s.isPro) {
          try { if (s.email) localStorage.setItem("chefEmail", s.email); } catch { /* storage unavailable */ }
          void refresh();
          setState("welcome");
          timer = setTimeout(() => setLocation("/"), 3000);
          return;
        }
        if (n >= 9) { setState("unpaid"); return; }
        timer = setTimeout(() => void run(n + 1), 2000);
      } catch { if (!cancelled) setState("error"); }
    };
    void run(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId, isLoaded, isSignedIn, fetchStatus, refresh, setLocation]);

  const needSignIn = sessionId && isLoaded && !isSignedIn;
  return (
    <main className="sc-page sc-loading-page" data-testid="page-success">
      <div className="sc-loader-mark"><CookingPot size={22} /></div>
      {needSignIn ? (
        <>
          <h1>Sign in to confirm your payment</h1>
          <p>We'll verify your receipt as soon as you're signed in.</p>
          <Link className="sc-button sc-button-primary" href={signInUrl(`${basePath}/success?session_id=${encodeURIComponent(sessionId)}`)} data-testid="link-success-signin">Sign in</Link>
        </>
      ) : state === "welcome" ? (
        <><h1>Welcome to Chef's Edition 👑</h1><p>You're all set. Taking you home…</p></>
      ) : state === "checking" ? (
        <><h1>Confirming your payment…</h1><p><LoaderCircle className="sc-spin" size={16} /> This can take a few seconds.</p></>
      ) : state === "unpaid" ? (
        <><h1>We couldn't confirm a paid subscription yet</h1><p>If you were charged, check Settings in a minute or contact support.</p><Link className="sc-tool-button" href="/settings">Go to settings</Link></>
      ) : state === "error" ? (
        <><h1>Something went wrong verifying that receipt</h1><p>This receipt couldn't be verified for your account.</p><Link className="sc-tool-button" href="/">Back home</Link></>
      ) : (
        <><h1>No receipt found</h1><p>Open this page from your checkout confirmation.</p><Link className="sc-tool-button" href="/">Back home</Link></>
      )}
    </main>
  );
}
