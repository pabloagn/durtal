import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DuplicateWork } from "../wizard-model";

/** A search result that matches a book already in the catalogue */
export function DuplicateStep({
  duplicateWork,
  onAddEdition,
  onNewWork,
  cancel,
}: {
  duplicateWork: DuplicateWork;
  onAddEdition: () => void;
  onNewWork: () => void;
  cancel: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-sm border border-accent-gold/30 bg-accent-gold/5 p-4">
        <h3 className="type-item-title">
          Possible duplicate found
        </h3>
        <p className="mt-1 text-xs text-fg-secondary">
          A work with a similar title and author already exists in your
          catalogue.
        </p>
      </div>

      <Card>
        <CardContent className="py-4">
          <h3 className="type-item-title">
            {duplicateWork.title}
          </h3>
          <p className="mt-1 text-xs text-fg-secondary">
            {duplicateWork.workAuthors
              .map((wa) => wa.author.name)
              .join(", ")}
          </p>
          <div className="mt-2 flex gap-2">
            <Badge variant="muted">
              {duplicateWork.editions.length} edition
              {duplicateWork.editions.length !== 1 ? "s" : ""}
            </Badge>
            <Badge variant="muted">
              {duplicateWork.editions.reduce(
                (sum, e) => sum + e.instances.length,
                0,
              )}{" "}
              copies
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={onAddEdition}>
          Add edition to this work
        </Button>
        <Button variant="secondary" onClick={onNewWork}>
          Create as new work
        </Button>
        {cancel}
      </div>
    </div>
  );
}
