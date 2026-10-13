import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FadeImage } from "@/components/shared/fade-image";
import { OpenWorkLink } from "@/components/shared/open-work-link";
import { workHref } from "@/lib/catalogue/work-href";
import { mediaUrl } from "@/lib/s3/media-url";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import type { DuplicateWork } from "../wizard-model";

/** The cover the work's library card shows: its poster, else its first edition's cover */
function DuplicateCover({ work }: { work: DuplicateWork }) {
  const poster = work.media[0];
  const edition = work.editions[0];
  const key =
    poster?.thumbnailS3Key ??
    poster?.s3Key ??
    edition?.thumbnailS3Key ??
    edition?.coverS3Key;
  return (
    <div className="h-24 w-16 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
      {key ? (
        <FadeImage
          src={mediaUrl(key, { width: 240 })}
          alt={`${work.title} cover`}
          className="h-full w-full object-cover"
          style={poster ? mediaImageStyle(mediaCrop(poster)) : undefined}
        />
      ) : (
        <span className="flex h-full items-center justify-center text-center text-micro text-fg-secondary">
          No cover
        </span>
      )}
    </div>
  );
}

/** A search result that matches a book already in the catalogue */
export function DuplicateStep({
  duplicateWork,
  edited,
  onAddEdition,
  onNewWork,
  cancel,
}: {
  duplicateWork: DuplicateWork;
  /** The person has entered something in the wizard: opening the work asks first */
  edited: boolean;
  onAddEdition: () => void;
  onNewWork: () => void;
  cancel: ReactNode;
}) {
  const copies = duplicateWork.editions.reduce((sum, e) => sum + e.instances.length, 0);
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
        <CardContent className="flex gap-4 py-4">
          <DuplicateCover work={duplicateWork} />
          <div className="min-w-0">
            <h3 className="type-item-title [overflow-wrap:anywhere]">
              {duplicateWork.title}
            </h3>
            <p className="mt-1 text-xs text-fg-secondary [overflow-wrap:anywhere]">
              {duplicateWork.workAuthors
                .map((wa) => wa.author.name)
                .join(", ")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="muted">
                {duplicateWork.editions.length} edition
                {duplicateWork.editions.length !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="muted">
                {copies} {copies === 1 ? "copy" : "copies"}
              </Badge>
            </div>
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
        <OpenWorkLink
          href={workHref(duplicateWork)}
          label="Open this work"
          dirty={edited}
        />
        {cancel}
      </div>
    </div>
  );
}
