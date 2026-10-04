"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowLeft } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { getPrimaryEdition } from "@/lib/actions/editions";
import {
  applyMatch,
  previewMatch,
  type MatchPreview,
} from "@/lib/actions/match";
import type { MatchField, MatchValue } from "@/lib/match/plan";
import type { MatchSource } from "@/lib/match/source";
import { MatchPreviewStep } from "@/components/books/match-preview";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { toast } from "sonner";

interface MatchResult {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  year?: number;
  isbn?: string;
  coverUrl?: string;
  source: MatchSource;
  sourceId: string;
  publisher?: string;
  pageCount?: number;
  language?: string;
}

interface MatchAgainDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;
  /** If provided, rematch this specific edition. Otherwise, fetch the primary edition. */
  editionId?: string;
  currentTitle: string;
  currentAuthor: string;
  currentMetadataSource?: string | null;
}

type SourceFilter = "all" | "isbndb" | "google_books" | "open_library";

const SOURCE_LABELS: Record<string, string> = {
  isbndb: "ISBNdb",
  google_books: "Google Books",
  open_library: "Open Library",
};

function sourceBadgeVariant(source: string): "sage" | "blue" | "gold" {
  if (source === "isbndb") return "gold";
  return source === "google_books" ? "sage" : "blue";
}

export function MatchAgainDialog({
  open,
  onClose,
  workId,
  editionId: propEditionId,
  currentTitle,
  currentAuthor,
  currentMetadataSource,
}: MatchAgainDialogProps) {
  const router = useRouter();

  const [query, setQuery] = useState(`${currentTitle} ${currentAuthor}`.trim());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("isbndb");
  const [results, setResults] = useState<MatchResult[]>([]);
  /** What the server says about the sources: "Google Books is over its quota…" */
  const [notices, setNotices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Preview step
  const [selected, setSelected] = useState<MatchResult | null>(null);
  const [preview, setPreview] = useState<MatchPreview | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Resolved edition ID (from prop or fetched)
  const [resolvedEditionId, setResolvedEditionId] = useState<string | null>(
    propEditionId ?? null,
  );

  const resolveEditionId = useCallback(async () => {
    if (propEditionId) return propEditionId;
    if (resolvedEditionId) return resolvedEditionId;

    try {
      const edition = await getPrimaryEdition(workId);
      if (!edition) {
        toast.error("No edition found for this work");
        return null;
      }
      setResolvedEditionId(edition.id);
      return edition.id;
    } catch {
      toast.error("Failed to resolve edition");
      return null;
    }
  }, [propEditionId, resolvedEditionId, workId]);

  async function handleSearch() {
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    setSelected(null);

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        source: sourceFilter,
      });
      const res = await fetch(`/api/match?${params}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults(data.results ?? []);
      setNotices(data.notices ?? []);
    } catch {
      toast.error("Search failed");
      setResults([]);
      setNotices([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(result: MatchResult) {
    setSelected(result);
    setPreview(null);
    try {
      const edId = await resolveEditionId();
      if (!edId) return setSelected(null);
      setPreview(await previewMatch(edId, result.source, result.sourceId));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not read the source",
      );
      setSelected(null);
    }
  }

  async function handleSave(
    accepted: { field: MatchField; value: MatchValue }[],
    relink: boolean,
  ) {
    if (!selected || !resolvedEditionId) return;
    setConfirming(true);
    try {
      const { changed } = await applyMatch(
        resolvedEditionId,
        selected.source,
        selected.sourceId,
        accepted,
        relink,
      );
      toast.success(
        changed
          ? `${changed} ${changed === 1 ? "field" : "fields"} updated from ${SOURCE_LABELS[selected.source] ?? selected.source}`
          : "House links updated",
      );
      router.refresh();
      triggerActivityRefresh();
      handleClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update metadata",
      );
    } finally {
      setConfirming(false);
    }
  }

  function backToResults() {
    setSelected(null);
    setPreview(null);
  }

  function handleClose() {
    setSelected(null);
    setPreview(null);
    setResults([]);
    setSearched(false);
    setLoading(false);
    setConfirming(false);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  }

  const sourceLabel =
    currentMetadataSource && SOURCE_LABELS[currentMetadataSource]
      ? SOURCE_LABELS[currentMetadataSource]
      : "Manual";

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Match again"
      description={`Current source: ${sourceLabel}`}
    >
      {/* Preview view */}
      {selected ? (
        <div className="space-y-4">
          <button
            onClick={backToResults}
            disabled={confirming}
            className="flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Back to results
          </button>

          <div className="flex gap-3 rounded-sm border border-glass-border bg-bg-primary/60 p-4">
            {selected.coverUrl && (
              <img
                src={selected.coverUrl}
                alt=""
                className="h-16 w-11 flex-shrink-0 rounded-sm object-cover"
              />
            )}
            <div className="min-w-0">
              <h4 className="type-item-title">
                {selected.title}
              </h4>
              {selected.subtitle && (
                <p className="mt-0.5 text-xs text-fg-secondary">
                  {selected.subtitle}
                </p>
              )}
              <p className="mt-1 text-sm text-fg-secondary">
                {selected.authors.join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {selected.year && (
                  <span className="font-mono text-xs text-fg-secondary">
                    {selected.year}
                  </span>
                )}
                {selected.isbn && (
                  <span className="font-mono text-xs text-fg-secondary">
                    {selected.isbn}
                  </span>
                )}
                <Badge variant={sourceBadgeVariant(selected.source)}>
                  {SOURCE_LABELS[selected.source] ?? selected.source}
                </Badge>
              </div>
            </div>
          </div>

          {preview && resolvedEditionId ? (
            <MatchPreviewStep
              editionId={resolvedEditionId}
              preview={preview}
              saving={confirming}
              onCancel={backToResults}
              onSave={handleSave}
            />
          ) : (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-fg-secondary">
              <Spinner className="h-4 w-4" />
              Comparing with your edition...
            </div>
          )}
        </div>
      ) : (
        /* Search view */
        <div className="space-y-4">
          {/* Search input */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search by title, author, or ISBN..."
              />
            </div>
            <Button
              variant="secondary"
              size="md"
              onClick={handleSearch}
              disabled={loading || !query.trim()}
            >
              {loading ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Search
            </Button>
          </div>

          {/* Source filter */}
          <div className="flex gap-1">
            {(["all", "isbndb", "google_books", "open_library"] as SourceFilter[]).map(
              (s) => (
                <Button
                  key={s}
                  variant={sourceFilter === s ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setSourceFilter(s)}
                >
                  {s === "all" ? "All" : SOURCE_LABELS[s]}
                </Button>
              ),
            )}
          </div>

          {/* Results */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-5 w-5" />
            </div>
          )}

          {!loading &&
            notices.map((notice) => (
              <p key={notice} role="status" className="text-xs text-fg-secondary">
                {notice}
              </p>
            ))}
          {!loading && searched && results.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-secondary">
              No results found. Try a different search query.
            </p>
          )}

          {!loading && results.length > 0 && (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="flex items-start gap-3 rounded-sm border border-glass-border bg-bg-primary/40 p-3 transition-colors hover:bg-bg-tertiary/40"
                >
                  {/* Cover thumbnail */}
                  {result.coverUrl ? (
                    <img
                      src={result.coverUrl}
                      alt=""
                      className="h-16 w-11 flex-shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-11 flex-shrink-0 items-center justify-center rounded-sm bg-bg-tertiary/60">
                      <span className="font-serif text-xs text-fg-muted/40">
                        {result.title[0]}
                      </span>
                    </div>
                  )}

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-fg-primary">
                      {result.title}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-fg-secondary">
                      {result.authors.join(", ") || "Unknown author"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {result.year && (
                        <span className="font-mono text-micro text-fg-secondary">
                          {result.year}
                        </span>
                      )}
                      {result.isbn && (
                        <span className="font-mono text-micro text-fg-secondary">
                          {result.isbn}
                        </span>
                      )}
                      <Badge variant={sourceBadgeVariant(result.source)}>
                        {SOURCE_LABELS[result.source] ?? result.source}
                      </Badge>
                    </div>
                  </div>

                  {/* Select button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => handleSelect(result)}
                  >
                    Select
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
