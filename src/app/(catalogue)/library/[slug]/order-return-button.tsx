"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";
import { toast } from "@/lib/notifications/toast";

/**
 * Records the return of an order with the book in hand (SLN-1507), as the
 * pipeline and Hunting for do. Such an order has left the pipeline, so the
 * book page is where it can still change, and a book with an order in hand
 * can't be deleted until it is Returned.
 */
export function OrderReturnButton({ orderId, order }: { orderId: string; /** "Delivered order, Shakespeare and Company, Oct 3, 2026" */ order: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="shrink-0 whitespace-nowrap text-xs text-command touch-hit"
      aria-label={`Record return: ${order}`}
      aria-busy={pending || undefined}
      onClick={() =>
        !pending &&
        start(async () => {
          try {
            await updateOrderStatus(orderId, "returned");
            toast.success("Return recorded");
            router.refresh();
          } catch (error) {
            toast.error(refusalMessage(error, "Could not record return"));
          }
        })
      }
    >
      Record return
    </button>
  );
}
