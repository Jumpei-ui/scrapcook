import { Crown, LoaderCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useBilling, type LimitDetail } from "@/lib/billing";

export default function PaywallModal({ detail, onClose }: { detail: LimitDetail | null; onClose: () => void }) {
  const { status, busy, startUpgrade } = useBilling();
  const unavailable = status ? !status.billingReady : false;
  const reset = detail?.resetsAt ? new Date(detail.resetsAt).toLocaleString() : null;
  return (
    <Dialog open={!!detail} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="modal-paywall" style={{ background: "var(--sc-paper)", color: "var(--sc-ink)" }}>
        <DialogTitle>You've used your 3 free recipe searches today</DialogTitle>
        <DialogDescription>
          {detail?.message ?? "Free ScrapCook includes 3 generations per day."}{reset ? ` Resets ${reset}.` : ""}
        </DialogDescription>
        <div style={{ border: "1px solid #d9b44a", background: "#fff8dc", borderRadius: 14, padding: 16 }}>
          <strong style={{ fontSize: 18 }}>👑 Chef's Edition — $10 USD / month</strong>
          <ul style={{ margin: "8px 0 0 18px", listStyle: "disc", fontSize: 14 }}>
            <li>Unlimited recipe generations &amp; ingredient scans</li>
            <li>No ads</li>
            <li>Recurring monthly, cancel anytime</li>
          </ul>
        </div>
        <p className="sc-hint" data-testid="text-paywall-notice">
          Paid access removes your personal daily quota. Shared safety limits and temporary anti-abuse protections still apply.
        </p>
        {unavailable && <p className="sc-form-error" role="status">Upgrades are unavailable right now. Please try again later.</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="sc-button sc-button-primary" disabled={busy || unavailable} onClick={() => void startUpgrade()} data-testid="button-paywall-upgrade">
            {busy ? <LoaderCircle className="sc-spin" size={16} /> : <Crown size={16} />} Upgrade to Chef's Edition
          </button>
          <button type="button" className="sc-tool-button" onClick={onClose} data-testid="button-paywall-tomorrow">Return tomorrow</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
