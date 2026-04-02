"use client";

import { ActivityEventIcon } from "./activity-event-icon";
import { formatEventDescriptionSegments, type DescriptionSegment } from "@/lib/activity/event-config";
import { formatRelativeTime, formatFullDate } from "@/lib/utils/relative-time";
import type { ActivityMetadata } from "@/lib/db/schema/activity-events";

interface ActivityEventItemProps {
  eventKey: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

function DescriptionText({ segments }: { segments: DescriptionSegment[] }) {
  return (
    <span>
      {segments.map((seg, i) =>
        seg.type === "label" ? (
          <span
            key={i}
            className="inline-flex rounded-sm bg-bg-tertiary px-1.5 py-0.5 font-mono text-[11px] leading-none text-fg-primary"
          >
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </span>
  );
}

export function ActivityEventItem({
  eventKey,
  metadata,
  createdAt,
}: ActivityEventItemProps) {
  const segments = formatEventDescriptionSegments(
    eventKey,
    metadata as ActivityMetadata | null,
  );
  const relative = formatRelativeTime(createdAt);
  const full = formatFullDate(createdAt);

  return (
    <div className="relative flex items-center gap-3 py-1.5">
      {/* Icon dot sitting on the timeline line */}
      <div className="relative z-10 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-bg-primary">
        <ActivityEventIcon eventKey={eventKey} className="h-3.5 w-3.5" />
      </div>

      {/* Description + timestamp */}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] leading-snug text-fg-secondary">
          <DescriptionText segments={segments} />
        </p>
        <time
          className="flex-shrink-0 text-[11px] text-fg-muted"
          title={full}
        >
          {relative}
        </time>
      </div>
    </div>
  );
}

export { DescriptionText };
