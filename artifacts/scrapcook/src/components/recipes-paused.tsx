import { useEffect, useState } from "react";
import { Link } from "wouter";

export default function RecipesPaused({ resumesAt, onCheck }: { resumesAt: string; onCheck: () => void }) {
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((Date.parse(resumesAt) - now) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (remaining === 0) void Promise.resolve(onCheck()).catch(() => {}); }, [remaining, onCheck]);
  const countdown = [Math.floor(remaining / 3600), Math.floor(remaining / 60) % 60, remaining % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
  return <div className="sc-app">
    <main className="sc-page sc-loading-page" style={{ minHeight: "100dvh" }} data-testid="recipes-paused" role="status">
      <h1>🍳 We're cooking too much today!</h1>
      <p>We've hit our free recipe limit.</p>
      <p>Please come back tomorrow - resets at midnight.</p>
      <p>Midnight UTC in <strong data-testid="pause-countdown">{countdown}</strong></p>
      <p>(Pst... you can still add your own API key in Settings to keep cooking!)</p>
      <Link href="/settings" className="sc-button sc-button-primary">Settings</Link>
      <button type="button" className="sc-text-button" onClick={() => { void Promise.resolve(onCheck()).catch(() => {}); }}>Check again</button>
    </main>
  </div>;
}
