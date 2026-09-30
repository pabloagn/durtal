"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  GitMerge,
  ImageIcon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TextCursorInput,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { CapAligned } from "@/components/shared/cap-aligned";
import { Dialog } from "@/components/ui/dialog";
import {
  applyFindingFixes,
  dismissFinding,
  getHarmonizationOperation,
  getMergePreview,
  mergeRecords,
  restoreFinding,
  scanLibrary,
} from "@/lib/actions/harmonization";
import {
  CATEGORY_LABELS,
  ENTITIES,
  fieldLabel,
} from "@/lib/harmonization/registry";
import type {
  Category,
  Finding,
  MergePreview,
  Scan,
} from "@/lib/harmonization/types";

const ICONS: Record<Category, LucideIcon> = {
  duplicates: GitMerge,
  artwork: ImageIcon,
  metadata: TextCursorInput,
  integrity: ShieldCheck,
};
const NOTES: Record<Category, string> = {
  duplicates: "Bring scattered records together",
  artwork: "Complete the visual library",
  metadata: "Give every detail its place",
  integrity: "Keep relationships consistent",
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
const precise = (f: Finding) =>
  f.resolution.kind === "update" || f.resolution.kind === "poster";
const token = (f: Finding) => ({ key: f.key, fingerprint: f.fingerprint });
function IconLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className="h-icon-label">
      <CapAligned height={14}>
        <Icon size={14} strokeWidth={1.5} />
      </CapAligned>
      <span>{children}</span>
    </span>
  );
}
function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span className="h-muted">Not recorded</span>;
  if (typeof value === "object" && !Array.isArray(value))
    return (
      <span className="h-value">
        {Object.entries(value).map(([key, item]) => (
          <span key={key} className="h-group-value">
            <span>{fieldLabel(key)}: </span>
            {item === null
              ? "Not recorded"
              : typeof item === "boolean"
                ? item
                  ? "Yes"
                  : "No"
                : String(item)}
          </span>
        ))}
      </span>
    );
  return (
    <span className="h-value">
      {typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value)}
    </span>
  );
}
function Confidence({ finding }: { finding: Finding }) {
  return (
    <span className={`h-confidence h-confidence-${finding.confidence}`}>
      {finding.confidence === "high"
        ? "Strong evidence"
        : finding.confidence === "medium"
          ? "Worth reviewing"
          : "Needs judgment"}
    </span>
  );
}

export function HarmonizeWorkspace({
  initialScan,
  initialError,
}: {
  initialScan: Scan | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [scan, setScan] = useState(initialScan);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<Category | "all">("all");
  const [entity, setEntity] = useState("all");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());
  const [view, setView] = useState<"inbox" | "dismissed" | "history">("inbox");
  const [readyOnly, setReadyOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const [batch, setBatch] = useState<Finding[] | null>(null);
  const [excludedFixes, setExcludedFixes] = useState<Set<string>>(new Set());
  const selectedFixes = batch?.filter((f) => !excludedFixes.has(f.key)) || [];
  const [audit, setAudit] = useState<Record<string, unknown> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const findings = scan?.findings || [];
  const inbox = findings.filter((f) => !f.dismissed);
  const dismissed = findings.filter((f) => f.dismissed);
  const ready = inbox.filter(precise);
  const filtered = useMemo(
    () =>
      (scan?.findings || []).filter(
        (f) =>
          (view === "dismissed" ? f.dismissed : !f.dismissed) &&
          (category === "all" || f.category === category) &&
          (entity === "all" || f.entityLabel === entity) &&
          (!readyOnly || precise(f)) &&
          (!search ||
            [f.title, f.entityLabel, ...f.records.map((r) => r.name)]
              .join(" ")
              .toLowerCase()
              .includes(search)),
      ),
    [scan, view, category, entity, readyOnly, search],
  );
  const visible = filtered.slice(0, limit);
  const active = filtered.find((f) => f.key === selected) || filtered[0];
  const visibleReady = filtered.filter(precise).slice(0, 20);
  const entities = [...new Set(ENTITIES.map((e) => e.label))].sort();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target as HTMLElement)?.isContentEditable ||
        document.querySelector("dialog[open]") ||
        busy
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.key === "j" || event.key === "k") && visible.length) {
        event.preventDefault();
        const index = visible.findIndex((f) => f.key === active?.key);
        const next =
          visible[
            Math.max(
              0,
              Math.min(
                visible.length - 1,
                index + (event.key === "j" ? 1 : -1),
              ),
            )
          ];
        setSelected(next.key);
        document
          .getElementById(`finding-${next.key}`)
          ?.scrollIntoView({ block: "nearest" });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, active, busy]);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const result = await scanLibrary();
      if (result.ok) {
        setScan(result.value);
        router.refresh();
      } else setError(result.error);
    } catch {
      setError("The scan could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function fix(items: Finding[]) {
    setBusy(true);
    setError(null);
    try {
      const result = await applyFindingFixes(items.map(token));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { applied, failed } = result.value;
      if (applied.length)
        toast.success(
          `${applied.length} ${applied.length === 1 ? "finding resolved" : "findings resolved"}`,
        );
      setBatch(null);
      const updated = await scanLibrary();
      if (updated.ok) setScan(updated.value);
      if (failed.length)
        setError(
          `${failed.length} ${failed.length === 1 ? "finding still needs" : "findings still need"} attention. ${failed[0].error}`,
        );
      else if (!updated.ok)
        setError(
          `Changes were saved, but the queue could not refresh: ${updated.error}`,
        );
      router.refresh();
    } catch {
      setError(
        "The connection was interrupted. Rescan to check the result before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function decide(finding: Finding) {
    setBusy(true);
    setError(null);
    try {
      const result = finding.dismissed
        ? await restoreFinding(token(finding))
        : await dismissFinding({
            ...token(finding),
            reason:
              finding.category === "duplicates"
                ? "Keep as separate records"
                : "Intentional exception",
          });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setScan((current) =>
        current
          ? {
              ...current,
              findings: current.findings.map((f) =>
                f.key === finding.key
                  ? { ...f, dismissed: !finding.dismissed }
                  : f,
              ),
            }
          : current,
      );
      toast.success(
        finding.dismissed
          ? "Returned to the inbox"
          : "Dismissed. You can restore it anytime.",
      );
    } catch {
      setError("Could not save the decision. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function showAudit(id: string) {
    setBusy(true);
    try {
      const result = await getHarmonizationOperation(id);
      if (result.ok) setAudit(result.value);
      else setError(result.error);
    } catch {
      setError("Could not load this history entry.");
    } finally {
      setBusy(false);
    }
  }
  function resetFilters() {
    setCategory("all");
    setEntity("all");
    setQuery("");
    setReadyOnly(false);
    setLimit(60);
  }
  function downloadAudit() {
    const blob = new Blob([JSON.stringify(audit, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `durtal-harmonize-${audit?.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="harmonize">
      <header className="h-header">
        <div>
          <p className="h-eyebrow">
            Library care <span>/</span> Catalogue quality
          </p>
          <h1>
            Harmonize<span className="h-title-dot">.</span>
          </h1>
          <p className="h-intro">A little order, a more coherent library.</p>
        </div>
        <div className="h-scan-control">
          <button className="h-button" onClick={refresh} disabled={busy}>
            <IconLabel icon={RefreshCw}>
              {busy ? "Working…" : "Scan library"}
            </IconLabel>
          </button>
          <p>
            {scan
              ? `${scan.recordCount.toLocaleString()} records · ${scan.ruleCount} checks`
              : "Scan the entire catalogue"}
          </p>
        </div>
      </header>
      {error && (
        <div className="h-error" role="alert">
          <p>{error}</p>
          <button aria-label="Dismiss error" onClick={() => setError(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {scan && !scan.persistenceAvailable && (
        <p className="h-notice">
          The scan is available. Saving resolutions will be enabled when the
          harmonization database migration is applied.
        </p>
      )}
      <section className="h-stats" aria-label="Findings by category">
        {CATEGORIES.map((key, index) => (
          <button
            key={key}
            className={`h-stat ${category === key ? "h-stat-active" : ""}`}
            disabled={busy}
            onClick={() => {
              setCategory(category === key ? "all" : key);
              setView("inbox");
              setLimit(60);
            }}
            aria-pressed={category === key}
          >
            <div className="h-stat-label">
              <IconLabel icon={ICONS[key]}>{CATEGORY_LABELS[key]}</IconLabel>
              <span className="h-stat-index">0{index + 1}</span>
            </div>
            <div className="h-stat-number">
              {scan
                ? inbox
                    .filter((f) => f.category === key)
                    .length.toLocaleString()
                : "—"}
            </div>
            <p>{NOTES[key]}</p>
          </button>
        ))}
      </section>
      <div className="h-workspace-top">
        <div className="h-tabs" aria-label="Finding state">
          {(
            [
              ["inbox", "To resolve", inbox.length],
              ["dismissed", "Dismissed", dismissed.length],
              ["history", "Activity", scan?.history.length || 0],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              aria-pressed={view === key}
              disabled={busy}
              onClick={() => {
                setView(key);
                setSelected(null);
              }}
              className={view === key ? "h-tab-active" : ""}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <span className="h-scan-time">
          {scan
            ? `Scanned ${new Date(scan.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Awaiting first scan"}
        </span>
      </div>
      {view === "history" ? (
        <section className="h-history" aria-label="Resolution activity">
          <div className="h-history-heading">
            <h2>A record of your decisions</h2>
            <p>
              The last 50 resolutions, with original records and relationships
              preserved for inspection.
            </p>
          </div>
          {scan?.history.length ? (
            scan.history.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                onClick={() => showAudit(item.id)}
                className="h-history-row"
              >
                <span className="h-history-kind">
                  {item.action === "merge" ? "Merged" : "Resolved"}
                </span>
                <span>{item.label}</span>
                <time>{new Date(item.createdAt).toLocaleDateString()}</time>
              </button>
            ))
          ) : (
            <Empty
              title="A fresh start"
              description="Your first resolution will appear here."
            />
          )}
        </section>
      ) : (
        <>
          <div className="h-toolbar">
            <input
              ref={searchRef}
              aria-label="Search findings"
              disabled={busy}
              placeholder="Find a record or an issue…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(60);
              }}
            />
            <select
              aria-label="Filter by record type"
              disabled={busy}
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setLimit(60);
              }}
            >
              <option value="all">All record types</option>
              {entities.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <button
              className={`h-filter ${readyOnly ? "h-filter-active" : ""}`}
              disabled={busy}
              onClick={() => setReadyOnly(!readyOnly)}
              aria-pressed={readyOnly}
            >
              <IconLabel icon={Sparkles}>
                Ready to fix{" "}
                <span className="h-filter-count">{ready.length}</span>
              </IconLabel>
            </button>
            {category !== "all" && (
              <button
                className="h-filter h-filter-active"
                onClick={() => setCategory("all")}
              >
                {CATEGORY_LABELS[category]} ×
              </button>
            )}
          </div>
          <div className="h-workspace" aria-busy={busy}>
            <section className="h-queue" aria-label="Findings">
              <div className="h-queue-heading">
                <span>
                  {filtered.length.toLocaleString()}{" "}
                  {filtered.length === 1 ? "finding" : "findings"}
                </span>
                <span>Highest impact first</span>
              </div>
              <div className="h-queue-scroll">
                {visible.map((finding) => (
                  <button
                    id={`finding-${finding.key}`}
                    key={finding.key}
                    disabled={busy}
                    aria-pressed={active?.key === finding.key}
                    onClick={() => setSelected(finding.key)}
                    className={`h-finding ${active?.key === finding.key ? "h-finding-active" : ""}`}
                  >
                    <div className="h-finding-meta">
                      <span>{finding.entityLabel}</span>
                      <span
                        className={`h-category-marker h-marker-${finding.category}`}
                      >
                        {CATEGORY_LABELS[finding.category]}
                      </span>
                    </div>
                    <p className="h-finding-name">{finding.records[0].name}</p>
                    {finding.records.length > 1 && (
                      <p className="h-finding-other">
                        &{" "}
                        {finding.records
                          .slice(1)
                          .map((r) => r.name)
                          .join(", ")}
                      </p>
                    )}
                    <div className="h-finding-bottom">
                      <span>{finding.title}</span>
                      {precise(finding) && (
                        <span className="h-ready-mark">Ready to fix</span>
                      )}
                    </div>
                  </button>
                ))}
                {filtered.length > limit && (
                  <button
                    className="h-load-more"
                    onClick={() => setLimit(limit + 60)}
                  >
                    Show 60 more · {filtered.length - limit} remaining
                  </button>
                )}
                {!filtered.length && (
                  <Empty
                    title={
                      !scan
                        ? "Scan unavailable"
                        : inbox.length
                          ? "Nothing in this view"
                          : "All in order"
                    }
                    description={
                      !scan
                        ? "Retry the scan to check your catalogue."
                        : inbox.length
                          ? "Try another filter or search."
                          : "No findings need your attention right now."
                    }
                    action={
                      <button className="h-text-button" onClick={resetFilters}>
                        Clear filters
                      </button>
                    }
                  />
                )}
              </div>
              <div className="h-queue-footer">
                <span>
                  <kbd>J</kbd> <kbd>K</kbd> to navigate
                </span>
                <span>
                  <kbd>/</kbd> to search
                </span>
              </div>
            </section>
            <section className="h-review" aria-label="Review finding">
              {active ? (
                <FindingReview
                  key={`${active.key}:${active.fingerprint}:${active.dismissed}`}
                  finding={active}
                  disabled={busy || !scan?.persistenceAvailable}
                  onFix={() => fix([active])}
                  onDecide={() => decide(active)}
                  onMerged={refresh}
                  onError={setError}
                  onPending={setBusy}
                />
              ) : (
                <Empty
                  title={
                    view === "dismissed"
                      ? "No dismissed findings"
                      : "Room to breathe"
                  }
                  description={
                    view === "dismissed"
                      ? "Intentional exceptions will live here. Restore them whenever you like."
                      : "Select a finding to see its evidence and decide what happens next."
                  }
                />
              )}
            </section>
          </div>
          {view === "inbox" && visibleReady.length > 1 && (
            <div className="h-batch-bar">
              <div>
                <strong>
                  {filtered.filter(precise).length} fixes ready for review
                </strong>
                <p>
                  Only precise changes and reuse of existing images. Every merge
                  is reviewed individually.
                </p>
              </div>
              <button
                className="h-button"
                disabled={busy || !scan?.persistenceAvailable}
                onClick={() => {
                  setExcludedFixes(new Set());
                  setBatch(visibleReady);
                }}
              >
                Review {visibleReady.length} fixes
              </button>
            </div>
          )}
        </>
      )}
      <footer className="h-footer">
        <span>One catalogue. Fewer loose ends.</span>
        <button
          className="h-text-button"
          onClick={() => {
            setView("inbox");
            resetFilters();
          }}
        >
          All {scan?.entityCount || ENTITIES.length} record types
        </button>
      </footer>
      <Dialog
        open={!!batch}
        onClose={() => !busy && setBatch(null)}
        title="Review prepared fixes"
        description="Each change below is checked again before saving. Changed or conflicting records stay in the queue."
      >
        <div className="h-batch-list">
          {batch?.map((f) => (
            <label key={f.key}>
              <input
                type="checkbox"
                checked={!excludedFixes.has(f.key)}
                disabled={busy}
                onChange={() =>
                  setExcludedFixes((current) => {
                    const next = new Set(current);
                    if (next.has(f.key)) next.delete(f.key);
                    else next.add(f.key);
                    return next;
                  })
                }
              />
              <span>
                <strong>{f.records[0].name}</strong>
                <small>
                  {f.resolution.kind === "update"
                    ? Object.entries(f.resolution.changes)
                        .map(
                          ([key, value]) =>
                            `${fieldLabel(key)} → ${String(value)}`,
                        )
                        .join("; ")
                    : "Reuse stored image as poster"}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="h-dialog-actions">
          <button
            className="h-button"
            disabled={busy}
            onClick={() => setBatch(null)}
          >
            Cancel
          </button>
          <button
            className="h-button h-button-primary"
            disabled={busy || !selectedFixes.length}
            onClick={() => fix(selectedFixes)}
          >
            {busy ? "Applying…" : `Apply ${selectedFixes.length} fixes`}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={!!audit}
        onClose={() => setAudit(null)}
        title="Resolution record"
        description={String(audit?.label || "")}
        className="max-w-4xl"
      >
        <p className="h-audit-note">
          The original records, relationships and resulting state are retained
          here. Merges cannot be undone automatically.
        </p>
        <pre className="h-audit-json">{JSON.stringify(audit, null, 2)}</pre>
        <div className="h-dialog-actions">
          <button className="h-button" onClick={downloadAudit}>
            Download audit record
          </button>
        </div>
      </Dialog>
    </div>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="h-empty">
      <span className="h-empty-rule" />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

function FindingReview({
  finding: f,
  disabled,
  onFix,
  onDecide,
  onMerged,
  onError,
  onPending,
}: {
  finding: Finding;
  disabled: boolean;
  onFix: () => void;
  onDecide: () => void;
  onMerged: () => Promise<void>;
  onError: (error: string | null) => void;
  onPending: (pending: boolean) => void;
}) {
  const [targetId, setTargetId] = useState(f.recommendedId || f.records[0].id);
  const [fixConfirm, setFixConfirm] = useState(false);
  return (
    <>
      <div className="h-review-top">
        <span className="h-eyebrow">
          {CATEGORY_LABELS[f.category]} <span>/</span> {f.entityLabel}
        </span>
        <Confidence finding={f} />
      </div>
      <div className="h-review-body">
        <h2>{f.title}</h2>
        <p className="h-explanation">{f.explanation}</p>
        <div className="h-evidence">
          <p className="h-section-label">Why it surfaced</p>
          <ul>
            {f.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
        {f.resolution.kind === "merge" && !f.dismissed ? (
          <>
            <div className="h-section-heading">
              <h3>Choose the record to keep</h3>
              <span>01</span>
            </div>
            <div
              className="h-record-options"
              role="radiogroup"
              aria-label="Record to keep"
            >
              {f.records.map((record) => {
                const cannotKeep =
                  f.entity === "authors" &&
                  record.name.includes(",") &&
                  f.records.some((r) => !r.name.includes(","));
                return (
                  <div
                    key={record.id}
                    className={`h-record-option ${targetId === record.id ? "h-record-chosen" : ""}`}
                  >
                    <button
                      role="radio"
                      aria-checked={targetId === record.id}
                      disabled={disabled || cannotKeep}
                      onClick={() => setTargetId(record.id)}
                    >
                      <span className="h-record-choice">
                        {targetId === record.id
                          ? "Keep this record"
                          : cannotKeep
                            ? "Merge into natural name"
                            : "Choose this record"}
                        <span aria-hidden="true">
                          {targetId === record.id ? "●" : "○"}
                        </span>
                      </span>
                      <strong>{record.name}</strong>
                      <small>{record.context}</small>
                      {f.recommendedId === record.id && (
                        <span className="h-recommended">
                          Suggested canonical record
                        </span>
                      )}
                    </button>
                    <Link
                      href={record.href}
                      target="_blank"
                      className="h-record-link"
                    >
                      Open record ↗
                    </Link>
                  </div>
                );
              })}
            </div>
            <MergeReview
              key={targetId}
              finding={f}
              targetId={targetId}
              disabled={disabled}
              onMerged={onMerged}
              onError={onError}
              onPending={onPending}
            />
          </>
        ) : (
          <>
            <div className="h-record-links">
              {f.records.map((record) => (
                <Link key={record.id} href={record.href} target="_blank">
                  <span>
                    <strong>{record.name}</strong>
                    <small>{record.context}</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </Link>
              ))}
            </div>
            {f.resolution.kind === "update" && (
              <div className="h-change-preview">
                <p className="h-section-label">Prepared change</p>
                {Object.entries(f.resolution.changes).map(([key, value]) => (
                  <div key={key}>
                    <span>{fieldLabel(key)}</span>
                    <Value value={value} />
                  </div>
                ))}
              </div>
            )}
            {f.resolution.kind === "poster" && (
              <div className="h-artwork-preview">
                <Image
                  src={`/api/s3/read?key=${encodeURIComponent(f.resolution.thumbnailS3Key || f.resolution.s3Key)}`}
                  alt={`Proposed poster for ${f.records[0].name}`}
                  width={100}
                  height={144}
                  unoptimized
                />
                <div>
                  <p className="h-section-label">Already in your library</p>
                  <h3>Give this image a place</h3>
                  <p>
                    Assign this stored image as the active poster. The original
                    cover and file are preserved.
                  </p>
                </div>
              </div>
            )}
            {!precise(f) && !f.dismissed && (
              <div className="h-guidance">
                <h3>A decision only you can make</h3>
                <p>
                  Open the record to correct its details or manage its images,
                  then scan again. If this is intentional, dismiss it.
                </p>
              </div>
            )}
            {!f.dismissed && precise(f) && (
              <div className="h-resolution-actions">
                {fixConfirm ? (
                  <>
                    <p>
                      Apply this prepared change to{" "}
                      <strong>{f.records[0].name}</strong>?
                    </p>
                    <div className="h-action-row">
                      <button
                        className="h-button h-button-primary"
                        disabled={disabled}
                        onClick={onFix}
                      >
                        Confirm change
                      </button>
                      <button
                        className="h-text-button"
                        onClick={() => setFixConfirm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="h-button h-button-primary"
                    disabled={disabled}
                    onClick={() => setFixConfirm(true)}
                  >
                    <IconLabel icon={Check}>
                      {f.resolution.kind === "update" ||
                      f.resolution.kind === "poster"
                        ? f.resolution.label
                        : "Resolve"}
                    </IconLabel>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="h-review-footer">
        <span>
          {f.dismissed
            ? "Dismissed until the evidence changes."
            : "Intentional? Keep it out of your queue."}
        </span>
        <button
          className="h-text-button"
          disabled={disabled}
          onClick={onDecide}
        >
          {f.dismissed
            ? "Restore finding"
            : f.category === "duplicates"
              ? "Keep separate"
              : "Dismiss finding"}
        </button>
      </div>
    </>
  );
}
function MergeReview({
  finding,
  targetId,
  disabled,
  onMerged,
  onError,
  onPending,
}: {
  finding: Finding;
  targetId: string;
  disabled: boolean;
  onMerged: () => Promise<void>;
  onError: (message: string | null) => void;
  onPending: (pending: boolean) => void;
}) {
  const sourceId = finding.records.find((r) => r.id !== targetId)!.id;
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, "source" | "target">>(
    {},
  );
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    getMergePreview({ entity: finding.entity, sourceId, targetId })
      .then((result) => {
        if (!current) return;
        if (result.ok) {
          setPreview(result.value);
          setChoices({});
          setError(null);
        } else setError(result.error);
      })
      .catch(() => {
        if (current)
          setError("Could not load the merge preview. Please try again.");
      });
    return () => {
      current = false;
    };
  }, [finding.entity, sourceId, targetId, revision]);
  async function merge() {
    if (!preview) return;
    setPending(true);
    onPending(true);
    onError(null);
    try {
      const result = await mergeRecords({
        entity: finding.entity,
        sourceId,
        targetId,
        fingerprint: preview.fingerprint,
        choices,
      });
      if (!result.ok) {
        setError(result.error);
        setConfirm(false);
        return;
      }
      toast.success(`Merged into ${preview.target.name}`);
      setConfirm(false);
      await onMerged();
    } catch {
      setError(
        "The connection was interrupted. Rescan to check the result before retrying.",
      );
      setConfirm(false);
    } finally {
      setPending(false);
      onPending(false);
    }
  }
  const conflicts = preview?.fields.filter((f) => f.conflict) || [];
  const filled = preview?.fields.filter((f) => !f.conflict) || [];
  const unchosen = conflicts.filter((f) => !choices[f.key]).length;
  if (error)
    return (
      <div className="h-preview-error" role="alert">
        <p>{error}</p>
        <button
          className="h-text-button"
          onClick={() => {
            setPreview(null);
            setError(null);
            setRevision((r) => r + 1);
          }}
        >
          Reload preview
        </button>
      </div>
    );
  if (!preview)
    return (
      <p className="h-preview-loading" role="status">
        Checking fields and linked records…
      </p>
    );
  return (
    <div className="h-merge-review">
      <div className="h-section-heading">
        <h3>Reconcile the details</h3>
        <span>02</span>
      </div>
      {preview.blockers.length > 0 && (
        <div className="h-preview-error" role="alert">
          {preview.blockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
        </div>
      )}
      {conflicts.length ? (
        <>
          <div className="h-conflict-intro">
            <p>
              {unchosen
                ? `${unchosen} ${unchosen === 1 ? "value needs" : "values need"} your choice`
                : "Every conflict has a choice"}
            </p>
            <button
              className="h-text-button"
              disabled={pending}
              onClick={() =>
                setChoices(
                  Object.fromEntries(conflicts.map((f) => [f.key, "target"])),
                )
              }
            >
              Keep all current values
            </button>
          </div>
          <div className="h-conflicts">
            {conflicts.map((field) => (
              <fieldset key={field.key}>
                <legend>{field.label}</legend>
                <div className="h-field-options">
                  {(["target", "source"] as const).map((side) => {
                    const forbidComma =
                      finding.entity === "authors" &&
                      field.key === "name" &&
                      String(field[side]).includes(",") &&
                      !String(preview.targetRecord.name).includes(",");
                    return (
                      <label
                        key={side}
                        className={`${choices[field.key] === side ? "h-value-chosen" : ""} ${forbidComma ? "h-disabled" : ""}`}
                      >
                        <input
                          type="radio"
                          name={`field-${field.key}`}
                          checked={choices[field.key] === side}
                          disabled={pending || forbidComma}
                          onChange={() =>
                            setChoices((c) => ({ ...c, [field.key]: side }))
                          }
                        />
                        <span>
                          <small>
                            {side === "target"
                              ? "Keep current"
                              : "Use incoming"}
                          </small>
                          <Value
                            value={
                              field.display ? field.display[side] : field[side]
                            }
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </>
      ) : (
        <p className="h-no-conflicts">
          No conflicting values. The records complement each other.
        </p>
      )}
      {filled.length > 0 && (
        <details className="h-fill-details">
          <summary>
            {filled.length} missing {filled.length === 1 ? "field" : "fields"}{" "}
            will be filled from the other record
          </summary>
          <dl>
            {filled.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>
                  <Value value={f.display ? f.display.source : f.source} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className="h-impact">
        <p className="h-section-label">Everything stays connected</p>
        <div className="h-relationship-tags">
          {preview.relationships.length ? (
            preview.relationships.map((r) => (
              <span key={r.label}>
                <b>{r.count}</b> {r.label.toLowerCase()}
              </span>
            ))
          ) : (
            <span>No linked records to move</span>
          )}
        </div>
        <p>
          Links move to the surviving record. Its active artwork is kept; other
          images remain available. Original values are saved in Activity.
        </p>
      </div>
      <div className="h-resolution-actions">
        <button
          className="h-button h-button-primary"
          disabled={
            disabled || pending || unchosen > 0 || preview.blockers.length > 0
          }
          onClick={() => setConfirm(true)}
        >
          <IconLabel icon={GitMerge}>Review merge</IconLabel>
        </button>
        {unchosen > 0 && (
          <span className="h-action-hint">
            Choose the conflicting values above.
          </span>
        )}
      </div>
      <Dialog
        open={confirm}
        onClose={() => !pending && setConfirm(false)}
        title="One record, fully connected"
        description="Review the result before merging."
      >
        <div className="h-merge-confirm">
          <p className="h-section-label">Keep</p>
          <h3>{preview.target.name}</h3>
          <p className="h-section-label">Merge into it</p>
          <p>{preview.source.name}</p>
          <div className="h-confirm-summary">
            <p>
              {preview.relationships.reduce((n, r) => n + r.count, 0)} linked
              records will be transferred or combined.
            </p>
            <p>
              {filled.length} missing fields will be filled. {conflicts.length}{" "}
              field choices will be applied.
            </p>
            <p>
              The source record will be removed and its old links will follow
              the survivor. Its original data is retained in Activity. This
              merge has no automatic undo.
            </p>
          </div>
        </div>
        <div className="h-dialog-actions">
          <button
            className="h-button"
            disabled={pending}
            onClick={() => setConfirm(false)}
          >
            Back to review
          </button>
          <button
            className="h-button h-button-primary"
            disabled={pending}
            onClick={merge}
          >
            {pending ? "Merging…" : "Confirm merge"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
