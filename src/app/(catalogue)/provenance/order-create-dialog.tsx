"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  OrderTargetFields,
  type OrderTargetValue,
} from "@/components/publishers/order-target-fields";
import type { getTargetOrderSeed } from "@/lib/actions/publishers";
import { useRouter } from "next/navigation";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
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
  type OrderVenue,
} from "./order-create-steps";
import { createOrder, createOrderForNewBook, createOrderGroup } from "@/lib/actions/catalogue-client";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/shared/section-heading";
import { refusalMessage } from "@/lib/actions/refusal";
import { ActionRefusal } from "@/lib/actions/action-refusal";
import { isOrderHref } from "@/lib/constants/orders";
import { useSaveReason } from "@/components/shared/save-reason";

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
  // One create at a time: a second press before the first returns ordered twice
  const inFlight = useRef(false);
  // The target's open order, from the seed or the server's refusal, until
  // "Order again anyway" (SLN-1119)
  const [openOrder, setOpenOrder] = useState(
    seed?.openOrder ? { ...seed.openOrder, targetId: seed.target.id } : null,
  );
  // The target "Order again anyway" was pressed for
  const [againFor, setAgainFor] = useState<string | null>(null);
  const orderAgain =
    !!targetValue.acquisitionTargetId && againFor === targetValue.acquisitionTargetId;
  const shownOrder =
    openOrder?.targetId === targetValue.acquisitionTargetId && !orderAgain
      ? openOrder
      : null;

  // Reload and Back open the page, not New order for a target just ordered
  useEffect(() => {
    if (!seed) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("target");
    window.history.replaceState(null, "", url);
  }, [seed]);

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
  const [venue, setVenue] = useState<OrderVenue | null>(null);
  const [otherBooks, setOtherBooks] = useState<WorkResult[]>([]);
  const [addingBook, setAddingBook] = useState(false);
  const [linePrices, setLinePrices] = useState<Record<string, string>>({});
  const [lineTargets, setLineTargets] = useState<Record<string, OrderTargetValue>>({});
  const [notes, setNotes] = useState("");
  // The book it opened with (from a target) is not the owner's own work yet
  const [arrivedWith, setArrivedWith] = useState(seed?.work ?? null);
  // Unsaved work the fields do not show: a picked book, method, status or shop
  const picked =
    selectedWork !== arrivedWith ||
    method !== "online_order" ||
    status !== "placed" ||
    venue !== null;

  function resetForm() {
    setArrivedWith(null);
    setOpenOrder(null);
    setAgainFor(null);
    setStep(0);
    setSelectedWork(null);
    setTargetValue({ acquisitionTargetId: "", editionId: "" });
    setMethod("online_order");
    setStatus("placed");
    setDetails({ ...INITIAL_DETAILS, currency: homeCurrency });
    setVenue(null);
    setOtherBooks([]);
    setAddingBook(false);
    setLinePrices({});
    setLineTargets({});
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

  function handleSubmit(again = orderAgain) {
    // While the target's open order is shown, only "Order again anyway" orders
    if (inFlight.current || (shownOrder && !again)) return;
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

    inFlight.current = true;
    const targetId = targetValue.acquisitionTargetId;
    startTransition(async () => {
      try {
        const order = {
          acquisitionTargetId: targetValue.acquisitionTargetId || null,
          editionId: targetValue.editionId || null,
          // A gift has no shop: who gave it is its origin
          venueId: method === "gift" ? null : (venue?.id ?? null),
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
        if (otherBooks.length) {
          await createOrderGroup({ ...order, items: [selectedWork, ...otherBooks].map((book, index) => ({
            workId: book.id,
            price: index === 0 ? priceVal : (linePrices[book.id] || null),
            acquisitionTargetId: (index === 0 ? targetValue : lineTargets[book.id])?.acquisitionTargetId || null,
            editionId: (index === 0 ? targetValue : lineTargets[book.id])?.editionId || null,
          })) });
        } else if (selectedWork.draft)
          await createOrderForNewBook({ book: selectedWork.draft, order });
        else
          await createOrder(
            { ...order, workId: selectedWork.id },
            { orderAgain: again || undefined },
          );
        toast.success(otherBooks.length ? `Order for ${otherBooks.length + 1} books created` : `Order for "${selectedWork.title}" created`);
        setOpen(false);
        resetForm();
        router.refresh();
      } catch (err) {
        // The target is on order already: say so here, with the way to it
        if (err instanceof ActionRefusal && isOrderHref(err.href) && targetId)
          setOpenOrder({ message: err.message, href: err.href, targetId });
        else toast.error(refusalMessage(err, "Failed to create order"));
      } finally {
        inFlight.current = false;
      }
    });
  }

  const saveReason = useSaveReason(
    step === 0 && !selectedWork
      ? "Choose a book"
      : step === 2 && !details.orderDate
        ? "Add the order date"
        : step === STEP_LABELS.length - 1 && !!shownOrder && "Order again, or open the existing order",
    "ml-auto",
  );
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
        // Where focus goes when the board's last order is deleted (SLN-1118)
        data-focus-empty="orders"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        New order
      </Button>

      <Dialog
        draft
        dirty={picked}
        onSave={() => handleSubmit()}
        open={open}
        onClose={handleClose}
        title="New order"
        description={`Step ${step + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[step]}`}
        className="max-w-3xl"
      >
        {/* Step indicator */}
        <div className="mb-5 flex gap-1.5">
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-accent-primary/60" : "bg-glass-border"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[260px]">
          {step === 0 && (<>
            {otherBooks.map((book) => <div key={book.id} className="mb-2 flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{book.title}</span><Button size="sm" variant="ghost" aria-label={`Remove ${book.title}`} onClick={() => setOtherBooks((books) => books.filter((item) => item.id !== book.id))}>Remove</Button>
            </div>)}
            <WorkSearchStep
              selectedWork={addingBook ? null : selectedWork}
              onSelect={(work) => {
                if (addingBook) {
                  if (work.draft) { toast.error("Save the new book before adding it to a multi-book order"); return; }
                  if (work.id === selectedWork?.id || otherBooks.some((book) => book.id === work.id)) { toast.error("This book is already in the order"); return; }
                  setOtherBooks((books) => [...books, work]);
                  setAddingBook(false);
                  return;
                }
                setSelectedWork(work);
                setOtherBooks([]);
                setTargetValue({ acquisitionTargetId: "", editionId: "" });
              }}
            />
            {selectedWork && !selectedWork.draft && otherBooks.length < 49 && <Button className="mt-3" size="sm" variant="secondary" onClick={() => setAddingBook(!addingBook)}>{addingBook ? "Done adding books" : "Add another book"}</Button>}
          </>)}
          {/* The hunt and edition sit with the method, inside the step's
              height, so a short step leaves no gap above them (SLN-983). A
              draft book has no targets or editions yet. */}
          {step === 1 && (
            <div className="space-y-4">
              <MethodStep
                method={method}
                onMethodChange={setMethod}
                status={status}
                onStatusChange={setStatus}
              />
              {selectedWork && !selectedWork.draft && (
                <div className="space-y-2">
                {otherBooks.length > 0 && <SectionHeading as="h4" title={selectedWork.title} />}
                <OrderTargetFields
                  key={selectedWork.id}
                  workId={selectedWork.id}
                  value={targetValue}
                  onChange={setTargetValue}
                />
                </div>
              )}
              {otherBooks.map((book) => <div key={book.id} className="space-y-2"><SectionHeading as="h4" title={book.title} /><OrderTargetFields workId={book.id} value={lineTargets[book.id] ?? { acquisitionTargetId: "", editionId: "" }} onChange={(value) => setLineTargets((values) => ({ ...values, [book.id]: value }))} /></div>)}
            </div>
          )}
          {step === 2 && (<>
            <DetailsStep
              method={method}
              form={details}
              onChange={handleDetailsChange}
              venue={venue}
              onVenueChange={setVenue}
              priceLabel={otherBooks.length ? `Price: ${selectedWork?.title}` : undefined}
            />
            {otherBooks.map((book) => <Input key={book.id} label={`Price: ${book.title}`} className="mt-3" type="number" min="0" step="0.01" value={linePrices[book.id] ?? ""} onChange={(event) => setLinePrices((values) => ({ ...values, [book.id]: event.target.value }))} />)}
          </>)}
          {step === 3 && <NotesStep notes={notes} onChange={setNotes} />}
        </div>

        {/* Back or Cancel at the start, Next or Create at the end: under the
            dialog's body and always in view (SLN-1056) */}
        <DialogFooter>
          {/* Above the buttons, so Back and Create keep one row */}
          {shownOrder && (
            <div
              role="status"
              className="flex basis-full flex-wrap items-center gap-2 rounded-sm border border-glass-border p-3 text-sm text-fg-secondary"
            >
              {shownOrder.message}
              <Link
                href={shownOrder.href}
                onClick={(event) => (isPending ? event.preventDefault() : handleClose())}
                className="text-command touch-hit"
              >
                Open the existing order
              </Link>
              {/* Text, as the link beside it, so the two keep the row's gap */}
              <button
                type="button"
                className="text-command touch-hit"
                onClick={() => {
                  setAgainFor(targetValue.acquisitionTargetId);
                  if (step === STEP_LABELS.length - 1) handleSubmit(true);
                }}
              >
                Order again anyway
              </button>
            </div>
          )}
          <Button data-dismiss=""
            variant="ghost"
            size="sm"
            className="mr-auto"
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

          {saveReason.hint}
          {step < STEP_LABELS.length - 1 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
              aria-describedby={saveReason.describedBy}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleSubmit()}
              busy={isPending}
              disabled={!selectedWork || !!shownOrder}
              aria-describedby={saveReason.describedBy}
            >
              Create order
            </Button>
          )}
        </DialogFooter>
      </Dialog>
    </>
  );
}
