import { useRef, type ComponentProps } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

/** A fresh navigation also discards drafts and any in-flight result callbacks. */
export default function FreshStartLogo(props: ComponentProps<typeof Link>) {
  const busy = useRef(false);
  const { toast } = useToast();

  return <Link {...props} title="Back to home - clear ingredients"
    style={{ ...props.style, cursor: "pointer" }}
    onClick={async (event) => {
      event.preventDefault();
      if (busy.current) return;
      busy.current = true;
      const home = event.currentTarget.href;
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const response = await fetch(`${base}/api/scrapcook/session`, {
          method: "DELETE", credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Reset failed");
        localStorage.removeItem("ingredients");
        window.scrollTo({ top: 0, behavior: "smooth" });
        window.location.assign(home);
      } catch {
        busy.current = false;
        toast({ title: "Couldn't start fresh", description: "Please try clicking the logo again.", variant: "destructive" });
      }
    }} />;
}
