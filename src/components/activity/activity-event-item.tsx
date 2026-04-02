"use client";

import { ActivityEventIcon } from "./activity-event-icon";
import { formatEventDescription } from "@/lib/activity/event-config";
import { formatRelativeTime, formatFullDate } from "@/lib/utils/relative-time";
import type { ActivityMetadata } from "@/lib/db/schema/activity-events";

interface ActivityEventItemProps {
  eventKey: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export function ActivityEventItem({
  eventKey,
  metadata,
  createdAt,
}: ActivityEventItemProps) {
  const description = formatEventDescription(
    eventKey,
    metadata as ActivityMetadata | null,
  );
  const relative = formatRelativeTime(createdAt);
  const full = formatFullDate(createdAt);

  return (
    <div className="relative -ml-[25px] mb-5 flex items-start gap-3">
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-glass-border bg-bg-secondary">
        <ActivityEventIcon eventKey={eventKey} className="h-3 w-3" />
      </div>
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2 pt-px">
        <p className="text-sm text-fg-secondary">{description}</p>
        <time
          className="flex-shrink-0 font-mono text-micro text-fg-muted"
          title={full}
        >
          {relative}
        </time>
      </div>
    </div>
  );
}
