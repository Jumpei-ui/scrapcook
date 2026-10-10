import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import FreshStartLogo from "@/components/fresh-start-logo";
import { useQueryClient } from "@tanstack/react-query";
import { CSVLink } from "react-csv";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowUpRight, Check, ChevronDown, CookingPot, Download, Leaf, Moon,
  Printer, RefreshCw, Settings2, Sun, TrendingUp,
} from "lucide-react";
import {
  getGetScrapCookSavingsDashboardQueryKey,
  useGetScrapCookSavingsDashboard,
} from "@workspace/api-client-react";
import type { SavingsDashboard } from "@workspace/api-client-react";

const CHART_COLORS = { green: "#638c54" };
const INTERVAL_OPTIONS = [
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every hour", ms: 60 * 60 * 1000 },
];
const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const formatMoney = (amount: number) => AUD.format(amount ?? 0);

function formatBrisbaneDate(date: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short" });
  }
  return new Date(date).toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" });
}
function chartDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short" });
}
function currencyTick(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function AppHeader() {
  return (
    <div className="sc-savings-top">
      <FreshStartLogo href="/" className="sc-savings-brand" aria-label="ScrapCook home">
        <span className="sc-brand-mark"><CookingPot size={18} /></span>
        <span>scrap<span>cook</span></span>
      </FreshStartLogo>
      <nav className="sc-savings-actions" aria-label="ScrapCook navigation">
        <Link className="sc-tool-button" href="/">Find a recipe</Link>
        <Link className="sc-tool-button" href="/settings"><Settings2 size={15} /> Settings</Link>
      </nav>
    </div>
  );
}

function SavingsSkeleton() {
  return (
    <div aria-label="Loading savings dashboard" role="status">
      <div className="sc-skeleton" style={{ height: 230, marginBottom: 16 }} />
      <div className="sc-period-grid">{[0, 1, 2, 3].map((item) => <div key={item} className="sc-skeleton" style={{ height: 126 }} />)}</div>
      <div className="sc-dashboard-grid"><div className="sc-skeleton" style={{ height: 340 }} /><div className="sc-skeleton" style={{ height: 340 }} /></div>
    </div>
  );
}

function SavingsChart({ data, dark }: { data: SavingsDashboard["dailySavings"]; dark: boolean }) {
  const gridColor = dark ? "rgba(255,255,255,.09)" : "rgba(58,72,52,.12)";
  const tickColor = dark ? "#c3c8bc" : "#72796e";
  const rows = data.map((item) => ({ ...item, day: chartDate(item.date) }));
  return (
    <ResponsiveContainer width="100%" height="100%" debounce={0}>
      <BarChart data={rows} margin={{ top: 7, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 5" stroke={gridColor} />
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: tickColor }} stroke={gridColor} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={currencyTick} tick={{ fontSize: 12, fill: tickColor }} stroke={gridColor} tickLine={false} axisLine={false} width={43} />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: CHART_COLORS.green, strokeDasharray: "3 4" }}
          formatter={(value: number) => [formatMoney(value), "Saved"]}
          labelStyle={{ color: "#273d31", fontWeight: 700, marginBottom: 4 }}
          contentStyle={{ backgroundColor: "#fbfaf4", border: "1px solid #dce2d3", borderRadius: 10, fontSize: 13 }}
        />
        <Bar dataKey="amountSaved" name="Saved" radius={[6, 6, 0, 0]} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.date} fill={row.amountSaved < 0 ? "#A60808" : CHART_COLORS.green} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Metric({ label, amount }: { label: string; amount: number }) {
  const color = amount < 0 ? "#A60808" : "#638c54";
  return <div className="sc-period-card"><span>{label}</span><strong style={{ color }}>{formatMoney(amount)}</strong></div>;
}

export default function SavingsPage() {
  const queryClient = useQueryClient();
  const query = useGetScrapCookSavingsDashboard();
  const [isDark, setIsDark] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("scrapcook-theme") === "dark",
  );
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedIntervalMs, setSelectedIntervalMs] = useState(5 * 60 * 1000);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const loading = query.isLoading || query.isFetching;
  const dashboard = query.data;
  const dailySavings = useMemo(() => dashboard?.dailySavings ?? [], [dashboard?.dailySavings]);
  const hasChartActivity = dailySavings.some(({ amountSaved }) => amountSaved !== 0);
  const csvRows = useMemo(() => dailySavings.map(({ date, amountSaved }) => ({
    date: formatBrisbaneDate(date),
    amountSavedAUD: amountSaved.toFixed(2),
  })), [dailySavings]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    window.localStorage.setItem("scrapcook-theme", isDark ? "dark" : "light");
  }, [isDark]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { void queryClient.invalidateQueries({ queryKey: getGetScrapCookSavingsDashboardQueryKey() }); }, Math.max(5 * 60 * 1000, selectedIntervalMs));
    return () => window.clearInterval(timer);
  }, [autoRefresh, selectedIntervalMs, queryClient]);
  useEffect(() => {
    if (loading) setSpinning(true);
    else {
      const timer = window.setTimeout(() => setSpinning(false), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [loading]);
  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);
  const lastRefreshed = query.dataUpdatedAt
    ? new Date(query.dataUpdatedAt).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short" })
    : null;
  const errorText = query.error instanceof Error ? query.error.message : "Please try loading your savings again.";

  return (
    <main className="sc-savings-shell">
      <div className="sc-savings-wrap">
        <AppHeader />
        <div className="sc-savings-actions" style={{ justifyContent: "flex-end", marginTop: -22, marginBottom: 16 }}>
          <div className="relative" ref={dropdownRef}>
            <div className="sc-tool-button" style={{ padding: 0, overflow: "hidden" }}>
              <button type="button" onClick={() => void query.refetch()} disabled={loading} className="sc-refresh-main">
                <RefreshCw size={14} className={spinning ? "sc-spin" : ""} /> Refresh
              </button>
              <button type="button" onClick={() => setDropdownOpen((open) => !open)} className="sc-refresh-toggle" aria-label="Refresh options" aria-expanded={dropdownOpen}>
                <ChevronDown size={14} />
              </button>
            </div>
            {dropdownOpen && (
              <div className="sc-refresh-menu" role="menu">
                <label className="sc-auto-refresh">
                  <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
                  Auto-refresh
                </label>
                <p>Refresh interval</p>
                {INTERVAL_OPTIONS.map((option) => (
                  <button type="button" role="menuitemradio" aria-checked={selectedIntervalMs === option.ms} key={option.ms} onClick={() => { setSelectedIntervalMs(option.ms); setAutoRefresh(true); setDropdownOpen(false); }}>
                    {selectedIntervalMs === option.ms ? <Check size={14} /> : <span className="sc-check-placeholder" />}{option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="sc-tool-button" onClick={() => window.print()} aria-label="Print or save as PDF"><Printer size={15} /> PDF</button>
          <button type="button" className="sc-tool-button" onClick={() => setIsDark((dark) => !dark)} aria-label="Toggle dark mode">{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
        <section className="sc-save-hero">
          <div className="sc-save-hero-copy">
            <div className="sc-save-eyebrow"><Leaf size={14} /> Your kitchen, doing good</div>
            <h1>Good meals.<br />Real savings.</h1>
            <p>Every meal you make is a little win for your wallet.</p>
          </div>
          <div className="sc-save-hero-total">
            <span>Saved this year</span>
            {loading ? <div className="sc-skeleton" style={{ height: 49, width: 160, marginTop: 8 }} /> : <strong>{formatMoney(dashboard?.yearSavings ?? 0)}</strong>}
          </div>
        </section>
        {lastRefreshed && <p className="sc-last-refreshed">Updated {lastRefreshed} Brisbane time</p>}
        {query.isError && (
          <div className="sc-savings-error" role="alert">
            <span>We couldn't reach your savings: {errorText}</span>
            <button type="button" className="sc-tool-button" onClick={() => void query.refetch()}>Try again</button>
          </div>
        )}
        {loading && !dashboard ? <SavingsSkeleton /> : (
          <>
            <div className="sc-period-grid">
              <Metric label="Today" amount={dashboard?.todaySavings ?? 0} />
              <Metric label="Last 7 days" amount={dashboard?.weekSavings ?? 0} />
              <Metric label="This calendar month" amount={dashboard?.monthSavings ?? 0} />
              <Metric label="This calendar year" amount={dashboard?.yearSavings ?? 0} />
            </div>
            <div className="sc-dashboard-grid">
              <section className="sc-panel">
                <div className="sc-panel-heading">
                  <div><h2>Your week, at a glance</h2><p>Daily savings over the last 7 days · AUD</p></div>
                  {!loading && hasChartActivity && (
                    <CSVLink data={csvRows} filename="scrapcook-seven-day-savings.csv" className="sc-tool-button sc-chart-export" aria-label="Export chart data as CSV">
                      <Download size={14} /> CSV
                    </CSVLink>
                  )}
                </div>
                {loading ? <div className="sc-skeleton" style={{ height: 270 }} /> : hasChartActivity ? (
                  <div className="sc-chart-frame"><SavingsChart data={dailySavings} dark={isDark} /></div>
                ) : (
                  <div className="sc-empty-dashboard"><span className="sc-empty-dashboard-mark"><TrendingUp size={20} /></span><strong>No savings to chart yet.</strong><p>Once a cooked meal costs less or more than its comparison, daily savings will appear here.</p></div>
                )}
              </section>
              <section className="sc-panel">
                <div className="sc-panel-heading"><div><h2>Recently cooked</h2><p>Your latest kitchen wins</p></div></div>
                {loading ? (
                  <div className="sc-recent-list">{[0, 1, 2].map((row) => <div className="sc-skeleton" key={row} style={{ height: 62, marginBottom: 10 }} />)}</div>
                ) : dashboard?.recentMeals.length ? (
                  <div className="sc-recent-list">
                    {dashboard.recentMeals.map((meal) => (
                      <article className="sc-meal-row" key={meal.id}>
                        <div>
                          <div className="sc-meal-title">{meal.recipeName}</div>
                          <div className="sc-meal-meta">{formatBrisbaneDate(meal.createdAt)} · {formatMoney(meal.actualCost)} vs {meal.comparedToLabel}</div>
                        </div>
                        <div className="sc-meal-saving" style={meal.amountSaved < 0 ? { color: "#A60808" } : undefined}>
                          <strong style={meal.amountSaved < 0 ? { color: "#A60808" } : undefined}>
                            {meal.amountSaved < 0 ? formatMoney(meal.amountSaved) : `+${formatMoney(meal.amountSaved)}`}
                          </strong>
                          <span>{meal.amountSaved < 0 ? "over comparison" : "saved"}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="sc-empty-dashboard">
                    <span className="sc-empty-dashboard-mark"><CookingPot size={20} /></span>
                    <strong>Your first meal goes here.</strong>
                    <p>Find something delicious in your fridge, then log it to see your savings grow.</p>
                    <Link href="/" className="sc-button sc-button-primary">Find a recipe <ArrowUpRight size={15} /></Link>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        <footer className="sc-footer" style={{ marginTop: 28 }}>
          <span>Good food. Less waste.</span><span className="sc-footer-dot">·</span>
          <div className="sc-footer-links"><Link href="/">Find a recipe</Link><Link href="/settings">Savings settings</Link></div>
        </footer>
      </div>
    </main>
  );
}