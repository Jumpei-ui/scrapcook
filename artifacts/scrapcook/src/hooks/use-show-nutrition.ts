import { useEffect, useState } from "react";

export function readShowNutrition(): boolean {
  try {
    return localStorage.getItem("showNutrition") !== "false";
  } catch {
    return true;
  }
}

export function useShowNutrition() {
  const [showNutrition, setShowNutrition] = useState(readShowNutrition);

  useEffect(() => {
    const sync = () => setShowNutrition(readShowNutrition());
    window.addEventListener("storage", sync);
    window.addEventListener("show-nutrition-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("show-nutrition-change", sync);
    };
  }, []);

  const saveShowNutrition = (next: boolean) => {
    localStorage.setItem("showNutrition", String(next));
    setShowNutrition(next);
    window.dispatchEvent(new Event("show-nutrition-change"));
  };

  return [showNutrition, saveShowNutrition] as const;
}
