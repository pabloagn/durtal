"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";
const LinkEbookDialog = dynamic(() => import("./link-ebook-dialog").then((module) => module.LinkEbookDialog), { ssr: false });

export function LinkEbookButton({ workId, workTitle, editionId, instanceId }: {
  workId: string; workTitle: string; editionId: string; instanceId: string;
}) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Link2 aria-hidden strokeWidth={1.5} />Link an eBook…</Button>
    {open && <LinkEbookDialog workId={workId} workTitle={workTitle} editionId={editionId}
      instanceId={instanceId} onClose={() => setOpen(false)} />}</>;
}
