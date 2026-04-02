"use client";

import { useState, useEffect, useCallback } from "react";
import { getActivityTimeline, type TimelineItem } from "@/lib/actions/activity";
import { onActivityRefresh } from "@/lib/activity/refresh-event";
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

  // Listen for activity refresh events from any mutation on the page
  useEffect(() => {
    return onActivityRefresh(() => {
      fetchEvents().then((result) => {
        setEvents(result.events);
        setHasMore(result.hasMore);
      });
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

  const handleCommentAdded = (newComment?: {
    id: string;
    contentHtml: string;
    contentJson: unknown;
    eventId: string;
  }) => {
    if (newComment) {
      // Optimistic: insert the comment event at the top of the timeline
      const optimisticEvent: TimelineItem = {
        id: newComment.eventId,
        entityType,
        entityId,
        eventKey: `${entityType}.comment_added`,
        metadata: { commentId: newComment.id },
        createdAt: new Date(),
        comment: {
          id: newComment.id,
          contentHtml: newComment.contentHtml,
          contentJson: newComment.contentJson,
          updatedAt: new Date(),
          attachments: [],
        },
      };
      setEvents((prev) => [optimisticEvent, ...prev]);
    }

    // Background reconciliation — silently sync with server
    fetchEvents().then((result) => {
      setEvents(result.events);
      setHasMore(result.hasMore);
    });
  };

  const handleCommentDeleted = (commentId: string) => {
    // Optimistic: remove immediately
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
      <h2 className="mb-5 font-serif text-2xl text-fg-primary">Activity</h2>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-mono text-xs text-fg-muted">
            Loading activity...
          </span>
        </div>
      ) : events.length === 0 ? (
        <>
          <div className="flex items-center justify-center py-6">
            <span className="font-mono text-xs text-fg-muted">
              No activity yet
            </span>
          </div>
          {/* Comment editor at the bottom, even when empty */}
          <div className="mt-2">
            <CommentEditor
              entityType={entityType}
              entityId={entityId}
              onCommentAdded={handleCommentAdded}
            />
          </div>
        </>
      ) : (
        <>
          {/* Timeline with vertical line */}
          <div className="relative pl-[10px]">
            {/* Vertical timeline line */}
            <div className="absolute bottom-0 left-[19px] top-0 w-px bg-glass-border" />

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

          {hasMore && (
            <div className="mt-1 flex justify-center">
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

          {/* Comment editor at the bottom — like Linear */}
          <div className="mt-3 pl-[10px]">
            <div className="relative flex gap-3">
              {/* Icon dot for the editor */}
              <div className="relative z-10 mt-2 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-bg-primary">
                <div className="h-2 w-2 rounded-full bg-fg-muted/40" />
              </div>
              <div className="min-w-0 flex-1">
                <CommentEditor
                  entityType={entityType}
                  entityId={entityId}
                  onCommentAdded={handleCommentAdded}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
