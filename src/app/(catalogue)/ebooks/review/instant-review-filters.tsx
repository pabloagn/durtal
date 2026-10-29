"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EBOOK_FORMATS, formatLabel } from "@/lib/ebooks/formats";
import { languageName, normalizeLanguage } from "@/lib/utils/language";
import { useListSearchClear } from "@/lib/hooks/use-list-search-clear";
import { isComposing } from "@/lib/shortcuts/shortcuts";
import { ReviewFilters } from "./review-filters";

export function InstantReviewFilters({ languages }: { languages: string[] }) {
  const router = useRouter(), search = useSearchParams();
  const current = useRef(search.toString());
  const [values, setValues] = useState(() => new URLSearchParams(search.toString()));
  const [query, setQuery] = useState(values.get("q") ?? "");
  const [busy, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null), composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    current.current = search.toString();
    setValues(new URLSearchParams(current.current));
    if (document.activeElement !== input.current) setQuery(search.get("q") ?? "");
  }, [search]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function navigate(params: URLSearchParams) {
    params.delete("page");
    current.current = params.toString(); setValues(new URLSearchParams(params));
    startTransition(() => router.replace(`/ebooks/review${current.current ? `?${current.current}` : ""}`, { scroll: false }));
  }
  function sendQuery(value: string, delay = 150) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(current.current);
      if (value.trim()) params.set("q", value); else params.delete("q");
      navigate(params);
    }, delay);
  }
  function change(key: string, value: string) {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams(current.current);
    if (query.trim()) params.set("q", query); else params.delete("q");
    if (value) params.set(key, value); else params.delete(key);
    navigate(params);
  }
  useListSearchClear(input, (shouldNavigate) => { setQuery(""); if (shouldNavigate) sendQuery("", 0); });
  const active = ["language", "format", "hasIsbn"].filter((key) => values.has(key)).length;
  const languageChoices: { value: string; label: string; disabled?: boolean }[] = languages.map((value) => ({ value, label: languageName(value) ?? value }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
  const rawLanguage = values.get("language");
  const selectedLanguage = rawLanguage ? normalizeLanguage(rawLanguage) ?? rawLanguage : null;
  // Keep a stale URL filter visible, but only languages in the queue can be selected.
  if (selectedLanguage && !languages.includes(selectedLanguage)) languageChoices.unshift({
    value: selectedLanguage, label: `${languageName(selectedLanguage) ?? selectedLanguage} (no eBooks to review)`, disabled: true,
  });
  return <div aria-busy={busy} className="mb-8 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,2fr)_1fr_1fr_1fr]">
    <ReviewFilters active={active} onClear={() => {
      if (timer.current) clearTimeout(timer.current);
      const params = new URLSearchParams(current.current);
      if (query.trim()) params.set("q", query); else params.delete("q");
      for (const key of ["language", "format", "hasIsbn"]) params.delete(key);
      navigate(params);
    }} search={<Input ref={input} label="Title or author" type="search" name="q" value={query} maxLength={200}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; sendQuery(event.currentTarget.value); }}
      onChange={(event) => { setQuery(event.target.value); if (!composing.current) sendQuery(event.target.value); }}
      onKeyDown={(event) => { if (event.key === "Enter" && !isComposing(event)) { event.preventDefault(); sendQuery(query, 0); } }} />}
      filters={<>
        <Select label="Language" name="language" value={selectedLanguage ?? ""}
          options={[{ value: "", label: "All languages" }, ...languageChoices]} onChange={(event) => change("language", event.target.value)} />
        <Select label="Format" name="format" value={values.get("format") ?? ""}
          options={[{ value: "", label: "All formats" }, ...EBOOK_FORMATS.map((value) => ({ value, label: formatLabel(value) }))]} onChange={(event) => change("format", event.target.value)} />
        <Select label="ISBN" name="hasIsbn" value={values.get("hasIsbn") ?? ""}
          options={[{ value: "", label: "Any ISBN" }, { value: "yes", label: "Has ISBN" }, { value: "no", label: "No ISBN" }]} onChange={(event) => change("hasIsbn", event.target.value)} />
      </>} />
  </div>;
}
