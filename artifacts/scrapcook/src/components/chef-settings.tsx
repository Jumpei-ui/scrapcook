import { useState } from "react";
import { useClerk, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { LoaderCircle } from "lucide-react";
import { useBilling, billingError, basePath } from "@/lib/billing";
import { useQueryClient } from "@tanstack/react-query";

export default function ChefSettings() {
  const { status, isPro, busy, openPortal, startUpgrade, fetchStatus, signInUrl, loading } = useBilling();
  const { user, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [working, setWorking] = useState(false);
  const verified = user?.primaryEmailAddress?.verification?.status === "verified"
    ? user.primaryEmailAddress.emailAddress : null;

  const restore = async () => {
    setErr(""); setMismatch(false);
    const typed = email.trim();
    if (!typed) { setErr("Enter the email you subscribed with."); return; }
    if (!isSignedIn) {
      setLocation(`${signInUrl(`${basePath}/settings`)}&email=${encodeURIComponent(typed)}`);
      return;
    }
    if (!verified || typed.toLowerCase() !== verified.toLowerCase()) {
      setMismatch(true);
      setErr(`That email doesn't match the account you're signed in with${verified ? ` (${verified})` : ""}. Sign out to switch accounts.`);
      return;
    }
    setWorking(true);
    try {
      const s = await fetchStatus({ email: typed } as Parameters<typeof fetchStatus>[0]);
      qc.setQueryData(["chef-status", user?.id ?? "anon"], s);
      if (!s.isPro) setErr("No active Chef's Edition subscription found for this account.");
    } catch (e) { setErr(billingError(e, "We couldn't restore that subscription (access denied for this email).")); }
    finally { setWorking(false); }
  };

  return (
    <section className="sc-panel" data-testid="panel-chef-settings">
      <div className="sc-panel-heading"><div><h2>👑 Chef's Edition</h2><p>$10 USD monthly, recurring. Cancel anytime from the billing portal.</p></div></div>
      <div className="sc-settings-form">
        {loading ? <div className="sc-skeleton" style={{ height: 46 }} /> : isPro ? (
          <>
            <p className="sc-settings-success" role="status" data-testid="status-chef-pro">Active — unlimited personal quota{status?.email ? ` for ${status.email}` : ""}.</p>
            {status?.expiresAt && <p className="sc-hint">Current period ends {new Date(status.expiresAt).toLocaleDateString()}. Cancel anytime; access continues until then.</p>}
            <p className="sc-hint">{status?.limitsNotice ?? "Shared safety limits and anti-abuse protections still apply."}</p>
            <button type="button" className="sc-button sc-button-primary" disabled={busy} onClick={() => void openPortal()} data-testid="button-manage-subscription">
              {busy && <LoaderCircle className="sc-spin" size={16} />} Manage subscription
            </button>
          </>
        ) : (
          <>
            <p className="sc-hint">Free: {status?.freeRemaining ?? 3} of 3 searches left today.</p>
            <button type="button" className="sc-button sc-button-primary" disabled={busy || (!!status && !status.billingReady)} onClick={() => void startUpgrade()} data-testid="button-settings-upgrade">Upgrade to Chef's Edition</button>
            {status && !status.billingReady && <p className="sc-hint">Upgrades are unavailable right now.</p>}
          </>
        )}
        <label className="sc-field">Restore a subscription by email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-restore-email" />
        </label>
        {err && <p className="sc-form-error" role="alert" data-testid="text-restore-error">{err}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isSignedIn && !isPro && (
            <button type="button" className="sc-tool-button" disabled={busy}
              onClick={() => void openPortal()}>Manage subscription</button>
          )}
          <button type="button" className="sc-tool-button" disabled={working} onClick={() => void restore()} data-testid="button-restore-subscription">
            {working && <LoaderCircle className="sc-spin" size={14} />} Restore subscription
          </button>
          {isSignedIn && (
            <button type="button" className="sc-tool-button" onClick={() => void signOut({ redirectUrl: basePath || "/" })} data-testid="button-chef-signout">
              Sign out{verified ? ` (${verified})` : ""}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
