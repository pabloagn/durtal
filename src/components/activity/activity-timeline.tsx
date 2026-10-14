"use client";

import type { ActivityEntityType } from "@/lib/activity/entities";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getActivityTimeline, type TimelineItem } from "@/lib/actions/activity";
import { onActivityRefresh } from "@/lib/activity/refresh-event";
import { ActivityEventItem } from "./activity-event-item";
import { CommentItem } from "./comment-item";
import { CommentEditor } from "./comment-editor";
import { ChevronDown } from "lucide-react";
import { SectionHeading } from "@/components/shared/section-heading";

interface ActivityTimelineProps {
  entityType: ActivityEntityType;
  entityId: string;
  /**
   * Changes when the page renders again (after a save and router.refresh):
   * the history reloads, so a change made by any dialog shows at once.
   */
  refreshKey?: string;
}

export function ActivityTimeline({ entityType, entityId, refreshKey }: ActivityTimelineProps) {
  const [events, setEvents] = useState<TimelineItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [loadError, setLoadError] = useState(false);
  const request = useRef({ active: false, generation: 0, ownerToken: null as symbol | null });
  const owner = `${entityType}:${entityId}`;
  const previousOwner = useRef(owner);
  const ownerToken = useMemo(() => Symbol(owner), [owner]);

  const readEvents = useCallback(async (cursor?: string, append = false) => {
    const current = request.current;
    if (!current.active || current.ownerToken !== ownerToken) return;
    const generation = ++current.generation;
    const ownsResult = () => current.active && current.ownerToken === ownerToken && current.generation === generation;
    setLoadingMore(append);
    try {
      const result = await getActivityTimeline(entityType, entityId, 20, cursor);
      if (!ownsResult()) return;
      setEvents((prev) => append ? [...prev, ...result.events] : result.events);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
      setLoadError(false);
    } catch {
      // A departed or superseded read is still caught, but cannot affect this view.
      if (ownsResult()) setLoadError(true);
    } finally {
      if (ownsResult()) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [entityType, entityId, ownerToken]);

  useEffect(() => {
    request.current.active = true;
    request.current.ownerToken = ownerToken;
    if (previousOwner.current !== owner) {
      previousOwner.current = owner;
      setEvents([]);
      setHasMore(false);
      setNextCursor(null);
    }
    setLoading(true);
    setLoadError(false);
    void readEvents();
    return () => {
      request.current.active = false;
      request.current.generation++;
    };
  }, [readEvents, owner, ownerToken, refreshKey]);

  // Listen for activity refresh events from any mutation on the page.
  useEffect(() => onActivityRefresh(() => { void readEvents(); }), [readEvents]);

  const loadMore = () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    void readEvents(nextCursor, true);
  };

  const handleCommentAdded = (newComment?: {
    id: string;
    contentHtml: string;
    contentJson: unknown;
    eventId: string;
  }) => {
    if (!request.current.active || request.current.ownerToken !== ownerToken) return;
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

    // Keep the optimistic comment if reconciliation fails; offer a retry.
    void readEvents();
  };

  const handleCommentDeleted = (commentId: string) => {
    if (!request.current.active || request.current.ownerToken !== ownerToken) return;
    // A snapshot requested before the confirmed deletion cannot restore its row.
    request.current.generation++;
    setLoading(false);
    setLoadingMore(false);
    // Optimistic: remove immediately
    setEvents((prev) =>
      prev.filter((e) => {
        if (!e.comment) return true;
        return e.comment.id !== commentId;
      }),
    );
  };

  const handleCommentUpdated = () => { void readEvents(); };

  return (
    <section className="mb-8">
      <SectionHeading title="Activity" />

      {loadError && (
        <div role="alert" className="mb-3 flex items-center gap-2 text-xs text-fg-secondary">
          <span>Activity could not be loaded.</span>
          <button
            type="button"
            onClick={() => { setLoading(true); setLoadError(false); void readEvents(); }}
            className="touch-hit rounded-sm px-2 py-1 text-accent-primary hover:bg-bg-tertiary"
          >
            Retry activity
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-mono text-xs text-fg-secondary">
            Loading activity…
          </span>
        </div>
      ) : events.length === 0 ? (
        <>
          {!loadError && (
            <div className="flex items-center justify-center py-6">
              <span className="font-mono text-xs text-fg-secondary">
                No activity yet
              </span>
            </div>
          )}
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
                className="flex items-center gap-1 rounded-sm px-3 py-1.5 font-mono text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:min-h-11"
              >
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                {loadingMore ? "Loading…" : "Show more"}
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
