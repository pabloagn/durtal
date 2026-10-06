"use client";

import { Button } from "@/components/ui/button";

/** "Print": the browser's print dialog, which also saves a PDF (the Year in review, SLN-456) */
export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="pointer-coarse:h-11" data-print="">
      Print
    </Button>
  );
}
