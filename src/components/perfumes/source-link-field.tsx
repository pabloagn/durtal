"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CONCENTRATION_LABELS } from "@/lib/catalogue/perfume-labels";
import { readPerfumeLink, type PerfumeLinkReading } from "@/lib/catalogue/perfume-sources";
import { reviewPerfumeSource, type PerfumeSourceReview } from "@/lib/actions/perfume-sources";

export interface SourceLinkState {
  link: string;
  reading: PerfumeLinkReading | null;
  /** Add the formulation the link names, once the perfume exists */
  addFormulation: boolean;
}

/**
 * A link to where the perfume was read about. Durtal reads the address, not
 * the page: a Fragrantica, Basenotes or Parfumo address names the house and
 * the perfume, which the person checks. A Wikidata address is looked up.
 * The link is kept as the perfume's source when it is added.
 */
export function SourceLinkField({
  value,
  onChange,
  onUse,
}: {
  value: SourceLinkState;
  onChange: (value: SourceLinkState) => void;
  /** Fills the form's empty fields from what the link says */
  onUse: (found: { title: string | null; review: PerfumeSourceReview | null }) => void;
}) {
  const reading = value.reading;
  const [looking, setLooking] = useState(false);
  const [review, setReview] = useState<PerfumeSourceReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalid = value.link.trim() !== "" && !reading;

  const says = useMemo(() => {
    if (!reading) return [];
    const { title, house, concentration } = reading.hints;
    return [
      title && `the perfume “${title}”`,
      house && `the house “${house}”`,
      concentration && `the concentration ${CONCENTRATION_LABELS[concentration].label.toLowerCase()}`,
    ].filter((x): x is string => !!x);
  }, [reading]);

  async function lookUp() {
    if (!reading?.externalId) return;
    setLooking(true);
    setError(null);
    const result = await reviewPerfumeSource({ perfumeId: null, externalId: reading.externalId });
    setLooking(false);
    if ("error" in result) return setError(result.error);
    setReview(result);
  }

  return (
    <div className="space-y-2">
      <Input
        label="Source link"
        type="url"
        value={value.link}
        placeholder="https:// (a Fragrantica, Basenotes, Parfumo or Wikidata page, or the house's own)"
        maxLength={4000}
        error={invalid ? "Enter an address that starts with http:// or https://" : undefined}
        onChange={(e) => {
          const link = e.target.value;
          const next = link.trim() ? readPerfumeLink(link) : null;
          setReview(null);
          setError(null);
          onChange({ link, reading: next, addFormulation: !!next?.hints.concentration });
        }}
      />
      {reading && (
        <div className="space-y-2 text-xs text-fg-secondary" role="status">
          <p>
            {reading.source
              ? `${reading.source.name}: ${reading.source.why}.`
              : "Durtal keeps this link as the perfume's source. It does not read the page."}{" "}
            {says.length > 0 && `Its address names ${says.join(", ")}.`}
          </p>
          {says.length > 0 && reading.hints.title && (
            <Button variant="ghost" size="sm" onClick={() => onUse({ title: reading.hints.title, review: null })}>
              Use the name
            </Button>
          )}
          {reading.hints.concentration && (
            <label className="flex items-start gap-3 text-sm text-fg-primary">
              <Switch
                checked={value.addFormulation}
                onCheckedChange={(on) => onChange({ ...value, addFormulation: on })}
                aria-label={`Add the ${CONCENTRATION_LABELS[reading.hints.concentration].label.toLowerCase()} formulation`}
              />
              <span>
                Add the {CONCENTRATION_LABELS[reading.hints.concentration].label.toLowerCase()} formulation with the perfume
              </span>
            </label>
          )}
          {reading.source?.access === "lookup" && reading.externalId && !review && (
            <Button variant="secondary" size="sm" disabled={looking} onClick={lookUp}>
              {looking && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
              Look up {reading.externalId}
            </Button>
          )}
          {review && (
            <div className="space-y-2">
              <p className="text-sm text-fg-primary">{review.title}</p>
              <p>
                {[
                  ...review.fields.filter((f) => f.field !== "title").map((f) => `${f.label}: ${f.source}`),
                  ...review.organizations.map((o) => `${o.role === "brand" ? "Brand" : "Manufacturer"}: ${o.name}${o.match ? "" : " (not in your library)"}`),
                  ...review.perfumers.map((p) => `Perfumer: ${p.name}${p.match ? "" : " (not in your library)"}`),
                ].join(" · ")}
              </p>
              <Button variant="ghost" size="sm" onClick={() => onUse({ title: review.title, review })}>
                Use these
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-accent-red-text">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
