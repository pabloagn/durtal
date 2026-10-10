"use client";
import { useRouter } from "next/navigation";
import { History, ListChecks } from "lucide-react";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
export function EbooksMenu() {
  const router = useRouter();
  return (
    <EntityActionMenu
      items={[
        {
          label: "Needs review",
          icon: ListChecks,
          onClick: () => router.push("/ebooks?review=yes"),
        },
        {
          label: "Ingestion runs",
          icon: History,
          onClick: () => router.push("/ebooks/runs"),
        },
      ]}
    />
  );
}
