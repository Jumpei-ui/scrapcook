import { useEffect, type ReactNode } from "react";
import { ClerkProvider } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { BillingProvider } from "@/lib/billing";
import SuccessPage from "@/pages/success";
import { SignInPage, SignUpPage } from "@/pages/auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import RecipePage from "@/pages/recipe-page";
import SavingsPage from "@/pages/savings";
import SettingsPage from "@/pages/settings";
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import "@/styles/scrapcook.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const stripBase = (path: string) => (basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path);
const clerkAppearance = {
  theme: "simple" as const,
  options: { logoPlacement: "inside" as const, logoLinkUrl: basePath || "/", logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: "#16a34a", colorForeground: "#21342a", colorMutedForeground: "#5d6b63", colorDanger: "#b42318",
    colorBackground: "#fffefa", colorInput: "#ffffff", colorInputForeground: "#21342a", colorNeutral: "#21342a",
    fontFamily: "inherit", borderRadius: "12px",
  },
  elements: {
    rootBox: { width: "100%", display: "flex", justifyContent: "center" },
    cardBox: { background: "#fffefa", width: "440px", maxWidth: "100%", border: "1px solid #e5e9e1", boxShadow: "0 18px 52px rgba(36,62,43,.07)" },
    headerTitle: { color: "#21342a" }, headerSubtitle: { color: "#5d6b63" },
    formFieldLabel: { color: "#21342a" }, footerActionText: { color: "#5d6b63" }, footerActionLink: { color: "#11763a" },
    formButtonPrimary: { background: "#16a34a", color: "#ffffff" },
  },
};

function ClerkShell({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
      localization={{ signIn: { start: { title: "Sign in to ScrapCook", subtitle: "Needed only for Chef's Edition" } } }}
      routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
      {children}
    </ClerkProvider>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/recipe/:recipeId" component={RecipePage} />
        <Route path="/savings" component={SavingsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/success" component={SuccessPage} />
        <Route path="/sign-in/:rest*?" component={SignInPage} />
        <Route path="/sign-up/:rest*?" component={SignUpPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => {
    try {
      localStorage.removeItem("gemini_api_key");
      localStorage.removeItem("spoonacular_api_key");
    } catch {
      // Restricted browser storage cannot be read or used for recipe credentials.
    }
  }, []);

  return (
    <WouterRouter base={basePath}>
      <ClerkShell>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <BillingProvider>
              <Router />
            </BillingProvider>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ClerkShell>
    </WouterRouter>
  );
}

export default App;
