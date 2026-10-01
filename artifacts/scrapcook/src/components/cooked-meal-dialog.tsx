import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, X } from "lucide-react";
import {
  getGetScrapCookSavingsDashboardQueryKey,
  useCreateScrapCookMeal,
  useEstimateScrapCookRecipeCost,
  useGetScrapCookSavingsDashboard,
} from "@workspace/api-client-react";
import type { SavingsComparisonLabel } from "@workspace/api-client-react";

const comparisonLabels: SavingsComparisonLabel[] = [
  "Takeaway",
  "Uber Eats",
  "HelloFresh",
  "Woolies new shop",
];
const formSchema = z.object({
  estimatePerServe: z.number().min(0, "Enter a value of $0 or more."),
  actualCost: z.number().min(0, "Enter a value of $0 or more."),
  comparedToLabel: z.enum(["Takeaway", "Uber Eats", "HelloFresh", "Woolies new shop"]),
  comparedToCost: z.number().min(0, "Enter a value of $0 or more."),
});
type MealFormValues = z.infer<typeof formSchema>;

function messageFor(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return fallback;
}

export default function CookedMealDialog({
  recipeId,
  recipeName,
  triggerClassName,
  triggerLabel = "I Cooked This!",
}: {
  recipeId: string;
  recipeName: string;
  triggerClassName: string;
  triggerLabel?: string;
}) {
  const queryClient = useQueryClient();
  const dashboard = useGetScrapCookSavingsDashboard();
  const estimateMutation = useEstimateScrapCookRecipeCost();
  const createMeal = useCreateScrapCookMeal();
  const [open, setOpen] = useState(false);
  const [estimateNote, setEstimateNote] = useState("");
  const defaultComparison = dashboard.data?.defaultComparison;
  const form = useForm<MealFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      estimatePerServe: 0,
      actualCost: 0,
      comparedToLabel: defaultComparison?.label ?? "Takeaway",
      comparedToCost: defaultComparison?.cost ?? 18.5,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      estimatePerServe: 0,
      actualCost: 0,
      comparedToLabel: dashboard.data?.defaultComparison.label ?? "Takeaway",
      comparedToCost: dashboard.data?.defaultComparison.cost ?? 18.5,
    });
    setEstimateNote("");
    estimateMutation.mutate(
      { data: { recipeId } },
      {
        onSuccess: (result) => {
          form.setValue("estimatePerServe", result.estimatedCostPerServe, { shouldValidate: true });
          form.setValue("actualCost", result.estimatedCostPerServe, { shouldValidate: true });
          setEstimateNote(result.note);
        },
      },
    );
  // Intentional: each dialog opening requests a fresh estimate for this recipe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipeId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createMeal.isPending) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, createMeal.isPending]);

  const submit = form.handleSubmit((values) => {
    createMeal.mutate(
      {
        data: {
          recipeName,
          actualCost: values.actualCost,
          comparedToLabel: values.comparedToLabel,
          comparedToCost: values.comparedToCost,
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetScrapCookSavingsDashboardQueryKey() });
          setOpen(false);
        },
      },
    );
  });
  const estimateError = estimateMutation.isError
    ? messageFor(estimateMutation.error, "We couldn't estimate this recipe. Try again.")
    : "";

  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-testid={`button-cooked-${recipeId}`}
      >
        {triggerLabel}
      </button>
      {open && (
        <div
          className="sc-dialog-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !createMeal.isPending) setOpen(false); }}
        >
          <section className="sc-dialog" role="dialog" aria-modal="true" aria-labelledby={`cooked-title-${recipeId}`}>
            <div className="sc-dialog-head">
              <div>
                <h2 id={`cooked-title-${recipeId}`}>A meal worth counting.</h2>
                <p>{recipeName}</p>
              </div>
              <button className="sc-dialog-close" type="button" onClick={() => setOpen(false)} disabled={createMeal.isPending} aria-label="Close cooked meal form">
                <X size={19} />
              </button>
            </div>
            {estimateMutation.isPending ? (
              <div className="sc-estimate-box" role="status">
                <div className="sc-skeleton" style={{ height: 19, width: "58%" }} />
                <p className="sc-estimate-note">Checking Australian grocery reference prices…</p>
              </div>
            ) : estimateError ? (
              <div className="sc-form-error" role="alert">
                <p>{estimateError}</p>
                <button type="button" className="sc-text-button" onClick={() => {
                  estimateMutation.mutate({ data: { recipeId } }, {
                    onSuccess: (result) => {
                      form.setValue("estimatePerServe", result.estimatedCostPerServe);
                      form.setValue("actualCost", result.estimatedCostPerServe);
                      setEstimateNote(result.note);
                    },
                  });
                }}>Try estimate again</button>
              </div>
            ) : (
              <div className="sc-estimate-box">
                <label className="sc-field">
                  Rough grocery estimate per serve (AUD)
                  <input data-testid={`input-estimate-per-serve-${recipeId}`} type="number" min="0" step="0.01" inputMode="decimal" {...form.register("estimatePerServe", { valueAsNumber: true })} />
                </label>
                <p className="sc-estimate-note">{estimateNote || "A rough Australian grocery-price reference; actual prices vary by shop and season."}</p>
                {form.formState.errors.estimatePerServe && <span className="sc-form-error">{form.formState.errors.estimatePerServe.message}</span>}
              </div>
            )}
            <form onSubmit={submit} noValidate>
              <div className="sc-form-grid">
                <label className="sc-field">
                  Actual meal cost (AUD)
                  <input data-testid={`input-actual-cost-${recipeId}`} type="number" min="0" step="0.01" inputMode="decimal" {...form.register("actualCost", { valueAsNumber: true })} />
                  {form.formState.errors.actualCost && <span className="sc-form-error">{form.formState.errors.actualCost.message}</span>}
                </label>
                <label className="sc-field">
                  Compare against
                  <select data-testid={`select-comparison-label-${recipeId}`} {...form.register("comparedToLabel")}>
                    {comparisonLabels.map((label) => <option key={label} value={label}>{label}</option>)}
                  </select>
                </label>
                <label className="sc-field">
                  Comparison cost (AUD)
                  <input data-testid={`input-comparison-cost-${recipeId}`} type="number" min="0" step="0.01" inputMode="decimal" {...form.register("comparedToCost", { valueAsNumber: true })} />
                  {form.formState.errors.comparedToCost && <span className="sc-form-error">{form.formState.errors.comparedToCost.message}</span>}
                </label>
              </div>
              {createMeal.isError && <p className="sc-form-error" role="alert">{messageFor(createMeal.error, "We couldn't save this meal. Please try again.")}</p>}
              <div className="sc-dialog-actions">
                <button data-testid={`button-cancel-cooked-${recipeId}`} className="sc-button sc-button-outline" type="button" onClick={() => setOpen(false)} disabled={createMeal.isPending}>Cancel</button>
                <button data-testid={`button-save-cooked-${recipeId}`} className="sc-button sc-button-primary" type="submit" disabled={createMeal.isPending || estimateMutation.isPending || estimateMutation.isError}>
                  {createMeal.isPending ? <LoaderCircle className="sc-spin" size={16} /> : <Check size={16} />}
                  Save cooked meal
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}