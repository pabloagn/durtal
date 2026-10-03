/** An acquisition target's state, in the colours the publisher page uses */
export const TARGET_STATE: Record<
  string,
  { label: string; variant: "gold" | "blue" | "sage" }
> = {
  wanted: { label: "Wanted", variant: "gold" },
  on_order: { label: "On order", variant: "blue" },
  received: { label: "Received", variant: "sage" },
};
