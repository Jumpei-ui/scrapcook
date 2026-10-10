import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { createChefCheckout, createChefPortal, getChefSubscription } from "@workspace/api-client-react";
import type { ChefSubscription, GetChefSubscriptionParams } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import PaywallModal from "@/components/paywall-modal";

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
export type LimitDetail = { message?: string; resetsAt?: string };

type Billing = {
  status: ChefSubscription | undefined;
  loading: boolean;
  isPro: boolean;
  busy: boolean;
  startUpgrade: () => Promise<void>;
  openPortal: () => Promise<void>;
  openPaywall: (detail?: LimitDetail) => void;
  refresh: () => Promise<ChefSubscription | undefined>;
  fetchStatus: (params?: GetChefSubscriptionParams) => Promise<ChefSubscription>;
  signInUrl: (redirect?: string) => string;
};
const Ctx = createContext<Billing | null>(null);
export function useBilling() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBilling outside BillingProvider");
  return v;
}
export function billingError(e: unknown, fallback: string) {
  if (e && typeof e === "object" && "data" in e) {
    const d = (e as { data?: { error?: string } }).data;
    if (d?.error) return d.error;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
let upgradeLaunched = false;

export function BillingProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState<LimitDetail | null>(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const authOpts = useCallback(async () => {
    const t = await getTokenRef.current().catch(() => null);
    return t ? { headers: { Authorization: `Bearer ${t}` } } : {};
  }, []);
  const fetchStatus = useCallback(async (params?: GetChefSubscriptionParams) =>
    getChefSubscription(params, { credentials: "same-origin", ...(await authOpts()) }), [authOpts]);

  const key = useMemo(() => ["chef-status", userId ?? "anon"], [userId]);
  const query = useQuery({ queryKey: key, queryFn: () => fetchStatus(), enabled: isLoaded, staleTime: 0, retry: 1,
    refetchInterval: 60_000, refetchOnWindowFocus: true });
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const refresh = useCallback(async () => (await refetchRef.current()).data, []);

  useEffect(() => {
    const on = (e: Event) => { setPaywall((e as CustomEvent<LimitDetail>).detail ?? {}); void refetchRef.current(); };
    window.addEventListener("chef-free-limit", on);
    return () => window.removeEventListener("chef-free-limit", on);
  }, []);

  const signInUrl = useCallback((redirect?: string) => {
    const r = redirect ?? `${basePath}/`;
    return `/sign-in?redirect=${encodeURIComponent(r)}`;
  }, []);

  const startCheckout = useCallback(async () => {
    setBusy(true);
    try {
      const res = await createChefCheckout({ credentials: "same-origin", ...(await authOpts()) });
      window.location.assign(res.url);
    } catch (e) {
      setBusy(false);
      toast({ title: "Couldn't start checkout", description: billingError(e, "Please try again."), variant: "destructive" });
    }
  }, [authOpts, toast]);

  const startUpgrade = useCallback(async () => {
    if (!isLoaded) return;
    if (query.data && !query.data.billingReady) {
      toast({ title: "Upgrades are unavailable right now", description: "Billing isn't set up yet. Please check back soon." });
      return;
    }
    setPaywall(null);
    if (!isSignedIn) { setLocation(signInUrl(`${basePath}/?upgrade=1`)); return; }
    await startCheckout();
  }, [isLoaded, isSignedIn, query.data, setLocation, signInUrl, startCheckout, toast]);

  const openPortal = useCallback(async () => {
    setBusy(true);
    try {
      const res = await createChefPortal({ credentials: "same-origin", ...(await authOpts()) });
      window.location.assign(res.url);
    } catch (e) {
      setBusy(false);
      toast({ title: "Couldn't open billing portal", description: billingError(e, "Please try again."), variant: "destructive" });
    }
  }, [authOpts, toast]);

  // account change => drop every user-scoped cache (skip first load)
  const prevUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    const id = userId ?? null;
    if (prevUser.current !== undefined && prevUser.current !== id) {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "chef-status" || q.queryKey[1] !== (id ?? "anon") });
    }
    prevUser.current = id;
  }, [isLoaded, userId, queryClient]);

  // post-auth upgrade launch: exactly once
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !query.data) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("upgrade") !== "1" || upgradeLaunched) return;
    upgradeLaunched = true;
    url.searchParams.delete("upgrade");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (query.data.isPro) return;
    if (!query.data.billingReady) {
      toast({ title: "Upgrades are unavailable right now", description: "Billing isn't set up yet." });
      return;
    }
    void startCheckout();
  }, [isLoaded, isSignedIn, query.data, startCheckout, toast]);
  void user;

  const value: Billing = {
    status: query.data, loading: !isLoaded || query.isLoading, isPro: !!query.data?.isPro, busy,
    startUpgrade, openPortal, openPaywall: (d) => setPaywall(d ?? {}), refresh, fetchStatus, signInUrl,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <PaywallModal detail={paywall} onClose={() => setPaywall(null)} />
    </Ctx.Provider>
  );
}
