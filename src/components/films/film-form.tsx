"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TitleInput } from "@/components/shared/title-input";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { TermListField, type TermEntry } from "@/components/catalogue/record-fields";
import { createFilm, findFilmsByTitle, updateFilm } from "@/lib/actions/films";
import { catalogueDateYears, type CatalogueDateInput } from "@/lib/catalogue/dates";
import { creditInput } from "@/lib/catalogue/film-labels";
import {
  ChoiceListField,
  CompaniesField,
  CreditsEditor,
  type Choice,
  type CompanyEntry,
  type FilmCreditEntry,
} from "./film-fields";
import { filmDirectors, filmHref, type FilmCardData } from "./film-card";

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

const GENRES = { slug: "film-genres", name: "Film genres" };

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
 * it, added on its page.
 */
function SameTitle({ title }: { title: string }) {
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
      className="space-y-2 rounded-sm border border-accent-gold/20 bg-accent-gold/5 px-3 py-2.5 text-sm"
    >
      <p className="text-fg-primary">
        {matches.length === 1
          ? "A film with this title is already in the catalogue."
          : "Films with this title are already in the catalogue."}
      </p>
      <ul className="space-y-1">
        {matches.map((film) => (
          <li key={film.id} className="text-fg-secondary">
            <Link
              href={filmHref(film)}
              className="text-fg-primary transition-colors hover:text-accent-rose-text"
            >
              {film.title}
            </Link>
            {[catalogueDateYears(film.releaseDate), filmDirectors(film)]
              .filter(Boolean)
              .map((part) => ` · ${part}`)
              .join("")}
            {" · "}
            <Link
              href={`${filmHref(film)}?add=version`}
              className="text-accent-rose-text transition-colors hover:text-fg-primary"
            >
              Add a version to it
            </Link>
          </li>
        ))}
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
      classificationItemIds: genres.map((g) => g.id),
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

  return (
    // ⌘Enter saves; on the create page this is the page's shortcut scope
    <div className="space-y-8" data-shortcut-scope="">
      <Section title="Titles">
        <TitleInput
          label="Title"
          value={title}
          onValueChange={setTitle}
          placeholder="The Thing"
          maxLength={500}
          required
        />
        {props.mode === "create" && <SameTitle title={title} />}
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

      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => (props.mode === "edit" ? props.onCancel() : router.push("/films"))}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={save} disabled={blocked || saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {props.mode === "create" ? "Add film" : "Save"}
        </Button>
      </div>
    </div>
  );
}
