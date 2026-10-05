"use client";

import { useState, useTransition } from "react";
import {
  OrderTargetFields,
  type OrderTargetValue,
} from "@/components/publishers/order-target-fields";
import type { getTargetOrderSeed } from "@/lib/actions/publishers";
import { useRouter } from "next/navigation";
import { Plus, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createOrder, createOrderForNewBook } from "@/lib/actions/orders";
import type { AcquisitionMethod, OrderStatus } from "@/lib/constants/orders";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import {
  WorkSearchStep,
  MethodStep,
  DetailsStep,
  NotesStep,
  INITIAL_DETAILS,
  type WorkResult,
  type DetailsForm,
} from "./order-create-steps";

const STEP_LABELS = ["Work", "Method", "Details", "Notes"];

export function OrderCreateDialog({
  seed,
}: {
  seed?: Awaited<ReturnType<typeof getTargetOrderSeed>>;
}) {
  const router = useRouter();
  // New orders start in the home currency (Settings)
  const { homeCurrency } = useAppSettings();
  const [open, setOpen] = useState(!!seed);
  const [targetValue, setTargetValue] = useState<OrderTargetValue>({
    acquisitionTargetId: seed?.target.id ?? "",
    editionId: seed?.target.editionId ?? "",
  });
  const [isPending, startTransition] = useTransition();

  // Form state
  const [step, setStep] = useState(seed ? 1 : 0);
  const [selectedWork, setSelectedWork] = useState<WorkResult | null>(
    seed?.work ?? null,
  );
  const [method, setMethod] = useState<AcquisitionMethod>("online_order");
  const [status, setStatus] = useState<OrderStatus>("placed");
  const [details, setDetails] = useState<DetailsForm>(() => ({
    ...INITIAL_DETAILS,
    currency: homeCurrency,
  }));
  const [notes, setNotes] = useState("");

  function resetForm() {
    setStep(0);
    setSelectedWork(null);
    setTargetValue({ acquisitionTargetId: "", editionId: "" });
    setMethod("online_order");
    setStatus("placed");
    setDetails({ ...INITIAL_DETAILS, currency: homeCurrency });
    setNotes("");
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    resetForm();
  }

  function handleDetailsChange(key: keyof DetailsForm, value: string) {
    setDetails((prev) => ({ ...prev, [key]: value }));
  }

  function canProceed(): boolean {
    switch (step) {
      case 0:
        return selectedWork !== null;
      case 1:
        return true;
      case 2:
        return Boolean(details.orderDate);
      case 3:
        return true;
      default:
        return false;
    }
  }

  function handleSubmit() {
    if (!selectedWork) {
      toast.error("Please select a work");
      return;
    }

    // H1: use !== "" instead of falsy check so "0" is preserved
    const priceVal = details.price !== "" ? details.price : null;
    const shippingVal =
      details.shippingCost !== "" ? details.shippingCost : null;
    const total =
      priceVal != null && shippingVal != null
        ? String(parseFloat(priceVal) + parseFloat(shippingVal))
        : (priceVal ?? shippingVal ?? null);

    startTransition(async () => {
      try {
        const order = {
          acquisitionTargetId: targetValue.acquisitionTargetId || null,
          editionId: targetValue.editionId || null,
          acquisitionMethod: method,
          status,
          orderDate: details.orderDate,
          orderConfirmation: details.orderConfirmation || null,
          orderUrl: details.orderUrl || null,
          carrier: details.carrier || null,
          trackingNumber: details.trackingNumber || null,
          trackingUrl: details.trackingUrl || null,
          estimatedDeliveryDate: details.estimatedDeliveryDate || null,
          price: priceVal,
          shippingCost: shippingVal,
          totalCost: total,
          currency: details.currency,
          originDescription: details.originDescription || null,
          notes: notes || null,
        };
        if (selectedWork.draft)
          await createOrderForNewBook({ book: selectedWork.draft, order });
        else await createOrder({ ...order, workId: selectedWork.id });
        toast.success(`Order for "${selectedWork.title}" created`);
        setOpen(false);
        resetForm();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create order",
        );
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        New Order
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        title="New Order"
        description={`Step ${step + 1} of ${STEP_LABELS.length} — ${STEP_LABELS[step]}`}
        className="max-w-3xl"
      >
        {/* Step indicator */}
        <div className="mb-5 flex gap-1.5">
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-accent-rose/60" : "bg-glass-border"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[260px]">
          {step === 0 && (
            <WorkSearchStep
              selectedWork={selectedWork}
              onSelect={(work) => {
                setSelectedWork(work);
                setTargetValue({ acquisitionTargetId: "", editionId: "" });
              }}
            />
          )}
          {step === 1 && (
            <MethodStep
              method={method}
              onMethodChange={setMethod}
              status={status}
              onStatusChange={setStatus}
            />
          )}
          {step === 2 && (
            <DetailsStep
              method={method}
              form={details}
              onChange={handleDetailsChange}
            />
          )}
          {step === 3 && <NotesStep notes={notes} onChange={setNotes} />}
        </div>

        {/* A draft book has no targets or editions yet */}
        {step === 1 && selectedWork && !selectedWork.draft && (
          <OrderTargetFields
            key={selectedWork.id}
            workId={selectedWork.id}
            value={targetValue}
            onChange={setTargetValue}
          />
        )}

        {/* Footer navigation */}
        <div className="mt-5 flex items-center justify-between border-t border-glass-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (step === 0 ? handleClose() : setStep((s) => s - 1))}
            disabled={isPending}
          >
            {step === 0 ? (
              "Cancel"
            ) : (
              <>
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                Back
              </>
            )}
          </Button>

          {step < STEP_LABELS.length - 1 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={isPending || !selectedWork}
            >
              {isPending ? (
                <>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.5}
                  />
                  Creating
                </>
              ) : (
                "Create Order"
              )}
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
