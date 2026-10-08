import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CookingPot, LoaderCircle, Settings2 } from "lucide-react";
import {
  getGetScrapCookSavingsDashboardQueryKey,
  useGetScrapCookSavingsDashboard,
  useUpdateScrapCookSavingsSettings,
} from "@workspace/api-client-react";
import type { SavingsComparisonLabel } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useShowNutrition } from "@/hooks/use-show-nutrition";

const options: SavingsComparisonLabel[] = ["Takeaway", "Uber Eats", "HelloFresh", "Woolies new shop"];
const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
function getError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return "We couldn't save your comparison. Please try again.";
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [showNutrition, setShowNutrition] = useShowNutrition();
  const queryClient = useQueryClient();
  const dashboard = useGetScrapCookSavingsDashboard();
  const updateSettings = useUpdateScrapCookSavingsSettings();
  const [label, setLabel] = useState<SavingsComparisonLabel>("Takeaway");
  const [cost, setCost] = useState("18.50");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!dashboard.data?.defaultComparison) return;
    setLabel(dashboard.data.defaultComparison.label);
    setCost(String(dashboard.data.defaultComparison.cost));
  }, [dashboard.data?.defaultComparison?.label, dashboard.data?.defaultComparison?.cost]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedCost = Number(cost);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) return;
    setSaved(false);
    updateSettings.mutate(
      { data: { label, cost: parsedCost } },
      {
        onSuccess: (comparison) => {
          queryClient.setQueryData(
            getGetScrapCookSavingsDashboardQueryKey(),
            (current: typeof dashboard.data) => current ? { ...current, defaultComparison: comparison } : current,
          );
          void queryClient.invalidateQueries({ queryKey: getGetScrapCookSavingsDashboardQueryKey() });
          setLabel(comparison.label);
          setCost(String(comparison.cost));
          setSaved(true);
        },
      },
    );
  };

  return (
    <main className="sc-savings-shell">
      <div className="sc-savings-wrap">
        <div className="sc-savings-top">
          <Link href="/" className="sc-savings-brand" aria-label="ScrapCook home"><span className="sc-brand-mark"><CookingPot size={18} /></span><span>scrap<span>cook</span></span></Link>
          <nav className="sc-savings-actions" aria-label="ScrapCook navigation">
            <Link className="sc-tool-button" href="/savings"><ArrowLeft size={15} /> Savings dashboard</Link>
            <Link className="sc-tool-button" href="/">Find a recipe</Link>
            <button
              type="button" className="sc-tool-button" role="switch"
              aria-label="Show Nutrition" aria-checked={showNutrition}
              data-testid="toggle-show-nutrition"
              style={showNutrition ? { background: "var(--sc-green)", borderColor: "var(--sc-green)", color: "white" } : undefined}
              onClick={() => {
                try { setShowNutrition(!showNutrition); }
                catch { toast({ title: "Could not save nutrition setting", description: "Browser storage is unavailable.", variant: "destructive" }); }
              }}
            >
              Show Nutrition {showNutrition ? "On" : "Off"}
            </button>
          </nav>
        </div>
        <section className="sc-save-hero">
          <div className="sc-save-hero-copy">
            <div className="sc-save-eyebrow"><Settings2 size={14} /> Your personal benchmark</div>
            <h1>Set what dinner<br />would have cost.</h1>
            <p>Choose a familiar alternative. We’ll use it as your default comparison.</p>
          </div>
          <div className="sc-save-hero-total"><span>Default benchmark</span><strong>{AUD.format(Number(cost) || 0)}</strong></div>
        </section>
        <div className="sc-settings-grid">
          <section className="sc-panel">
            <div className="sc-panel-heading"><div><h2>Default comparison</h2><p>Used whenever you record a cooked meal.</p></div></div>
            {dashboard.isLoading ? (
              <div className="sc-form-grid" role="status">
                <div className="sc-skeleton" style={{ height: 46 }} /><div className="sc-skeleton" style={{ height: 46 }} />
              </div>
            ) : dashboard.isError ? (
              <div className="sc-savings-error" role="alert"><span>Couldn't load saved settings.</span><button className="sc-tool-button" onClick={() => void dashboard.refetch()}>Try again</button></div>
            ) : (
              <form className="sc-settings-form" onSubmit={submit}>
                <label className="sc-field">
                  Compare my meal with
                  <select data-testid="select-default-comparison" value={label} onChange={(event) => setLabel(event.target.value as SavingsComparisonLabel)}>
                    {options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="sc-field">
                  Typical cost (AUD)
                  <input data-testid="input-default-comparison-cost" type="number" min="0" step="0.01" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} required />
                </label>
                {cost !== "" && (!Number.isFinite(Number(cost)) || Number(cost) < 0) && <p className="sc-form-error" role="alert">Enter a valid amount of AUD 0 or more.</p>}
                {updateSettings.isError && <p className="sc-form-error" role="alert">{getError(updateSettings.error)}</p>}
                {saved && <p className="sc-settings-success" role="status"><Check size={16} /> Your default comparison is saved.</p>}
                <button data-testid="button-save-default-comparison" className="sc-button sc-button-primary" type="submit" disabled={updateSettings.isPending || cost === "" || !Number.isFinite(Number(cost)) || Number(cost) < 0}>
                  {updateSettings.isPending ? <LoaderCircle className="sc-spin" size={16} /> : <Check size={16} />}
                  Save default
                </button>
              </form>
            )}
          </section>
          <aside className="sc-note-box">
            <strong>A useful reference, not a price promise.</strong>
            Comparison costs are your own estimate of a typical alternative. When you log a meal, you can adjust its comparison without changing this default.
          </aside>
        </div>
        <footer className="sc-footer" style={{ marginTop: 34 }}>
          <span>ScrapCook keeps your cooking journey in this browser.</span><span className="sc-footer-dot">·</span>
          <Link href="/savings">Back to savings</Link>
        </footer>
      </div>
    </main>
  );
}