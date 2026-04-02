"use client";

import { useState, useEffect, useCallback } from "react";
import { getActivityTimeline, type TimelineItem } from "@/lib/actions/activity";
import { ActivityEventItem } from "./activity-event-item";
import { CommentItem } from "./comment-item";
import { CommentEditor } from "./comment-editor";
import { ChevronDown } from "lucide-react";

interface ActivityTimelineProps {
  entityType: "work" | "author";
  entityId: string;
}

export function ActivityTimeline({ entityType, entityId }: ActivityTimelineProps) {
  const [events, setEvents] = useState<TimelineItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchEvents = useCallback(
    async (cursor?: string) => {
      const result = await getActivityTimeline(entityType, entityId, 20, cursor);
      return result;
    },
    [entityType, entityId],
  );

  useEffect(() => {
    setLoading(true);
    fetchEvents().then((result) => {
      setEvents(result.events);
      setHasMore(result.hasMore);
      setLoading(false);
    });
  }, [fetchEvents]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const lastEvent = events[events.length - 1];
    const cursor = lastEvent?.createdAt
      ? new Date(lastEvent.createdAt).toISOString()
      : undefined;
    const result = await fetchEvents(cursor);
    setEvents((prev) => [...prev, ...result.events]);
    setHasMore(result.hasMore);
    setLoadingMore(false);
  };

  const handleCommentAdded = () => {
    // Re-fetch to show the new comment
    fetchEvents().then((result) => {
      setEvents(result.events);
      setHasMore(result.hasMore);
    });
  };

  const handleCommentDeleted = (commentId: string) => {
    setEvents((prev) =>
      prev.filter((e) => {
        if (!e.comment) return true;
        return e.comment.id !== commentId;
      }),
    );
  };

  const handleCommentUpdated = () => {
    fetchEvents().then((result) => {
      setEvents(result.events);
      setHasMore(result.hasMore);
    });
  };

  return (
    <section className="mb-8">
      <h2 className="mb-4 font-serif text-xl text-fg-secondary">Activity</h2>

      <CommentEditor
        entityType={entityType}
        entityId={entityId}
        onCommentAdded={handleCommentAdded}
      />

      {loading ? (
        <div className="mt-6 flex items-center justify-center py-8">
          <span className="font-mono text-xs text-fg-muted">
            Loading activity...
          </span>
        </div>
      ) : events.length === 0 ? (
        <div className="mt-6 flex items-center justify-center py-8">
          <span className="font-mono text-xs text-fg-muted">
            No activity yet
          </span>
        </div>
      ) : (
        <div className="relative ml-2.5 mt-6 border-l border-glass-border pl-6">
          {events.map((event) =>
            event.comment ? (
              <CommentItem
                key={event.id}
                eventId={event.id}
                comment={event.comment}
                createdAt={event.createdAt}
                entityType={entityType}
                entityId={entityId}
                onDeleted={handleCommentDeleted}
                onUpdated={handleCommentUpdated}
              />
            ) : (
              <ActivityEventItem
                key={event.id}
                eventKey={event.eventKey}
                metadata={event.metadata}
                createdAt={event.createdAt}
              />
            ),
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-2 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-1 rounded-sm px-3 py-1.5 font-mono text-xs text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
          >
            <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            {loadingMore ? "Loading..." : "Show more"}
          </button>
        </div>
      )}
    </section>
  );
}
