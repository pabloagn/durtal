"use client";

import { ActivityEventIcon } from "./activity-event-icon";
import {
  formatEventDescriptionSegments,
  type DescriptionSegment,
} from "@/lib/activity/event-config";
import { formatRelativeTime, formatFullDate } from "@/lib/utils/relative-time";
import type { ActivityMetadata } from "@/lib/db/schema/activity-events";
import { CapAligned } from "@/components/shared/cap-aligned";

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
            className="inline-flex rounded-sm bg-bg-tertiary px-1.5 py-0.5 font-mono text-micro leading-none text-fg-primary"
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
    // The row carries the description's type: the dot sits on the cap-height
    // center of its first line, and the time on the same baseline
    <div className="relative flex items-start gap-3 py-1.5 text-xs leading-snug">
      {/* Icon dot sitting on the timeline line */}
      <CapAligned height={20} className="relative z-10">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-primary">
          <ActivityEventIcon eventKey={eventKey} className="h-3.5 w-3.5" />
        </div>
      </CapAligned>

      {/* Description + timestamp */}
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <p className="min-w-0 text-xs leading-snug text-fg-secondary">
          <DescriptionText segments={segments} />
        </p>
        <time className="flex-shrink-0 text-micro text-fg-secondary" data-tooltip={full}>
          {relative}
        </time>
      </div>
    </div>
  );
}

export { DescriptionText };
