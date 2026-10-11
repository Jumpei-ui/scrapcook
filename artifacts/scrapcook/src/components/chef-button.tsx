import { useBilling } from "@/lib/billing";

export default function ChefButton() {
  const { isPro, status, loading, busy, startUpgrade, openPortal } = useBilling();
  const unavailable = !isPro && !!status && !status.billingReady;
  return (
    <button type="button" className="sc-tool-button" disabled={loading || busy || unavailable}
      title={unavailable ? "Chef's Edition is unavailable right now" : undefined}
      onClick={() => void (isPro ? openPortal() : startUpgrade())} data-testid="button-chef-edition"
      style={{ background: "linear-gradient(135deg,#f6d365,#e0a82e)", borderColor: "#c8921a", color: "#3d2a00", fontWeight: 700 }}>
      {isPro ? status?.isTrial ? `👨‍🍳 Pro Trial - ${status.trialDaysLeft} days left` : "👨‍🍳 Pro · Unlimited" : "👨‍🍳 Try Chefs Edition Free"}
    </button>
  );
}
