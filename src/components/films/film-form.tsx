"use client";

import { RequiredNameHint } from "@/components/shared/required-name-hint";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
import { toast } from "@/lib/notifications/toast";
import { DialogFooter, PINNED_PAGE_FOOTER } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TitleInput } from "@/components/shared/title-input";
import { OpenWorkLink } from "@/components/shared/open-work-link";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { TermListField, type TermEntry } from "@/components/catalogue/record-fields";
import { createFilm, findFilmsByTitle, updateFilm } from "@/lib/actions/films";
import { catalogueDateYears, type CatalogueDateInput } from "@/lib/catalogue/dates";
import {
  FILM_GENRES_FAMILY,
  classificationInput,
  creditInput,
} from "@/lib/catalogue/film-labels";
import {
  ChoiceListField,
  CompaniesField,
  CreditsEditor,
  type Choice,
  type CompanyEntry,
  type FilmCreditEntry,
} from "./film-fields";
import { filmDirectors, filmHref, type FilmCardData } from "./film-card";
import { FilmPoster } from "./film-poster";

/** The identity of a stored film, as the edit form starts from it */
export interface EditableFilm {
  id: string;
  title: string;
  originalTitle: string | null;
  description: string | null;
  releaseDate: CatalogueDateInput | null;
  sourceRecordId: string | null;
  countries: Choice[];
  languages: Choice[];
  companies: CompanyEntry[];
  credits: FilmCreditEntry[];
  genres: TermEntry[];
  /** Terms of its other families (a mood, a theme), kept as they are on save */
  otherItemIds: string[];
}

/** The countries and languages a film chooses from */
export interface FilmChoices {
  countries: Choice[];
  languages: Choice[];
}

type Props =
  | { mode: "create"; choices: FilmChoices }
  | {
      mode: "edit";
      choices: FilmChoices;
      film: EditableFilm;
      fingerprint: string;
      /** The film's sources, to cite one for its release date */
      sources: { id: string; label: string }[];
      onSaved: () => void;
      onCancel: () => void;
    };

const GENRES = { slug: FILM_GENRES_FAMILY, name: "Film genres" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="type-group-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Films already in the catalogue under the title being typed. A remake is
 * a new film, so the form goes on; a cut of the same film is a version of
 * it, added on its page. Either link leaves the form: when more than the
 * title has been entered, it asks first.
 */
function SameTitle({ title, dirty }: { title: string; dirty: boolean }) {
  const [matches, setMatches] = useState<FilmCardData[]>([]);
  useEffect(() => {
    const name = title.trim();
    let live = true;
    const timer = setTimeout(() => {
      if (!name) return setMatches([]);
      findFilmsByTitle(name)
        .then((found) => live && setMatches(found))
        .catch(() => live && setMatches([]));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [title]);
  if (!matches.length) return null;
  return (
    <div
      role="status"
      className="space-y-3 rounded-sm border border-accent-gold/20 bg-accent-gold/5 px-3 py-2.5 text-sm"
    >
      <p className="text-fg-primary">
        {matches.length === 1
          ? "A film with this title is already in the catalogue."
          : "Films with this title are already in the catalogue."}
      </p>
      <ul className="space-y-3">
        {matches.map((film) => {
          const facts = [catalogueDateYears(film.releaseDate), filmDirectors(film)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={film.id} className="flex gap-3">
              <FilmPoster
                image={film.poster}
                title={film.title}
                className="w-12 shrink-0 self-start rounded-sm"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="type-item-title [overflow-wrap:anywhere]">{film.title}</p>
                  {facts && (
                    <p className="mt-0.5 text-fg-secondary [overflow-wrap:anywhere]">{facts}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  <OpenWorkLink href={filmHref(film)} label="Open this film" dirty={dirty} />
                  <OpenWorkLink
                    href={`${filmHref(film)}?add=version`}
                    label="Add a version to it"
                    dirty={dirty}
                    variant="ghost"
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-secondary">
        A remake or another film with the same title is a new film: go on
        here. A director&apos;s cut or another cut of the same film is a
        version of it.
      </p>
    </div>
  );
}

/**
 * A film's identity: titles, cast and crew, release, countries, languages,
 * production companies, genres and synopsis. Versions, releases and copies
 * are added on its page. Unknown values stay unknown: no field is required
 * but the title.
 */
export function FilmForm(props: Props) {
  const router = useRouter();
  const editing = props.mode === "edit" ? props.film : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [originalTitle, setOriginalTitle] = useState(editing?.originalTitle ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [release, setRelease] = useState(editing?.releaseDate ?? null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [countries, setCountries] = useState<Choice[]>(editing?.countries ?? []);
  const [languages, setLanguages] = useState<Choice[]>(editing?.languages ?? []);
  const [companies, setCompanies] = useState<CompanyEntry[]>(editing?.companies ?? []);
  const [credits, setCredits] = useState<FilmCreditEntry[]>(editing?.credits ?? []);
  const [genres, setGenres] = useState<TermEntry[]>(editing?.genres ?? []);
  const [sourceRecordId, setSourceRecordId] = useState(editing?.sourceRecordId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = !title.trim() || !!dateError;

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    const identity = {
      title: title.trim(),
      originalTitle: originalTitle.trim() || null,
      description: description.trim() || null,
      releaseDate: release,
      countryIds: countries.map((c) => c.id),
      languageIds: languages.map((l) => l.id),
      credits: creditInput(credits),
      classificationItemIds: classificationInput(
        genres.map((g) => g.id),
        editing?.otherItemIds ?? [],
      ),
    };
    try {
      if (props.mode === "create") {
        const film = await createFilm({
          ...identity,
          organizations: companies.map((c) => ({
            organizationId: c.organizationId,
            role: "production_company" as const,
          })),
        });
        toast.success("Film added");
        router.push(filmHref(film));
      } else {
        await updateFilm(
          props.film.id,
          {
            ...identity,
            organizations: companies.map((c) => ({
              organizationId: c.organizationId,
              role: "production_company" as const,
              sourceRecordId: c.sourceRecordId,
            })),
            sourceRecordId,
          },
          props.fingerprint,
        );
        toast.success("Film saved");
        props.onSaved();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the film";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  // On the create page, Esc cancels like Cancel, asking first when there is
  // unsaved work. In the edit dialog, the dialog does the same.
  const root = useRef<HTMLDivElement>(null);
  const unsavedPrompt = useEscapeToCancel({
    root,
    cancel: () => router.push("/films"),
    enabled: props.mode === "create" && !saving,
    track: true,
  });

  return (
    // ⌘Enter saves; on the create page this is the page's shortcut scope
    <>
    {unsavedPrompt}
    <div ref={root} className="space-y-8" data-shortcut-scope="">
      <Section title="Titles">
        <TitleInput
          label="Title"
          value={title}
          onValueChange={setTitle}
          placeholder="The Thing"
          maxLength={500}
          required
        />
        {props.mode === "create" && (
          <SameTitle
            title={title}
            dirty={
              !!originalTitle.trim() ||
              !!description.trim() ||
              !!release ||
              countries.length > 0 ||
              languages.length > 0 ||
              companies.length > 0 ||
              credits.length > 0 ||
              genres.length > 0
            }
          />
        )}
        <Input
          label="Original title"
          value={originalTitle}
          onChange={(e) => setOriginalTitle(e.target.value)}
          placeholder="When it differs: Le Samouraï"
          maxLength={500}
        />
      </Section>

      <Section title="Cast and crew">
        <CreditsEditor value={credits} onChange={setCredits} />
      </Section>

      <Section title="Release and origin">
        <div className="max-w-md">
          <CatalogueDateField
            label="First released"
            value={release}
            onChange={(value, err) => {
              setRelease(value);
              setDateError(err);
            }}
          />
        </div>
        {props.mode === "edit" && props.sources.length > 0 && (
          <div className="max-w-sm">
            <Select
              label="Source of this date"
              value={sourceRecordId ?? ""}
              placeholder="No source"
              onChange={(e) => setSourceRecordId(e.target.value || null)}
              options={props.sources.map((s) => ({ value: s.id, label: s.label }))}
            />
          </div>
        )}
        <div className="space-y-2 pt-1">
          <ChoiceListField
            label="Countries"
            noun="countries"
            choices={props.choices.countries}
            value={countries}
            onChange={setCountries}
          />
          <ChoiceListField
            label="Languages"
            noun="languages"
            choices={props.choices.languages}
            value={languages}
            onChange={setLanguages}
          />
          <CompaniesField value={companies} onChange={setCompanies} />
          <TermListField label="Genres" family={GENRES} value={genres} onChange={setGenres} />
        </div>
      </Section>

      <Section title="Synopsis">
        <Textarea
          aria-label="Synopsis"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={50000}
          placeholder="What happens, without the ending"
        />
      </Section>

      {/* Always in view, with the reason a save failed over the buttons:
          under the edit dialog's body, or pinned to the bottom of the add
          page (SLN-943) */}
      <DialogFooter outside={PINNED_PAGE_FOOTER}>
        <RequiredNameHint value={title} message="Give the film a title" />
        {error && (
          <p role="alert" className="basis-full text-sm text-accent-red-text">
            {error}
          </p>
        )}
        <Button
          variant="ghost"
          data-dismiss=""
          onClick={() => (props.mode === "edit" ? props.onCancel() : router.push("/films"))}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={save} busy={saving} disabled={blocked}>
          {props.mode === "create" ? "Add film" : "Save"}
        </Button>
      </DialogFooter>
    </div>
    </>
  );
}
