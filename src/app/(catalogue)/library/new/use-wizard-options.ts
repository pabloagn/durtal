"use client";

import { useEffect, useState } from "react";
import { getRecommenders } from "@/lib/actions/recommenders";
import { getLocations } from "@/lib/actions/locations";
import {
  getSubjects,
  getGenres,
  getTags,
  getCategories,
  getThemes,
  getLiteraryMovements,
  getArtTypes,
  getArtMovements,
  getKeywords,
  getAttributes,
} from "@/lib/actions/taxonomy";
import { getCollections } from "@/lib/actions/collections";
import { newCopyLocationId } from "@/lib/utils/instance-drafts";
import {
  perFamily,
  type LocationItem,
  type RefDataItem,
  type Step,
  type TaxonomyLists,
} from "./wizard-model";

const NO_LISTS: TaxonomyLists = perFamily(() => []);

const named = (items: { id: string; name: string }[]): RefDataItem[] =>
  items.map(({ id, name }) => ({ id, name }));

/**
 * What the wizard's steps choose from, each loaded once, when a step first
 * needs it: the recommenders on Details, the locations and the taxonomy from
 * the copies step on. The default location is the one from Settings, when it
 * is one of the locations.
 */
export function useWizardOptions(step: Step, settingsLocationId: string | null) {
  const [recommenders, setRecommenders] = useState<RefDataItem[]>([]);
  const [recommendersLoaded, setRecommendersLoaded] = useState(false);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [lists, setLists] = useState<TaxonomyLists>(NO_LISTS);
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [refDataLoaded, setRefDataLoaded] = useState(false);

  // Fetch recommenders when details step is reached
  useEffect(() => {
    if (recommendersLoaded) return;
    if (step !== "details" && step !== "confirm") return;
    setRecommendersLoaded(true);
    getRecommenders().then((data) => setRecommenders(named(data)));
  }, [step, recommendersLoaded]);

  // Fetch reference data when needed
  useEffect(() => {
    if (refDataLoaded) return;
    if (step !== "instance" && step !== "categorize" && step !== "confirm")
      return;
    setRefDataLoaded(true);
    Promise.all([
      getLocations(),
      getSubjects(),
      getGenres(),
      getTags(),
      getCollections(),
      getCategories(),
      getThemes(),
      getLiteraryMovements(),
      getArtTypes(),
      getArtMovements(),
      getKeywords(),
      getAttributes(),
    ]).then(([locs, subs, gens, tgs, cols, cats, thms, litMvs, artTps, artMvs, kwds, attrs]) => {
      const mappedLocations = locs.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        subLocations: named(l.subLocations),
      }));
      setLocations(mappedLocations);
      setDefaultLocationId(newCopyLocationId(mappedLocations, settingsLocationId));
      setLists({
        subjects: named(subs),
        genres: named(gens),
        tags: named(tgs),
        collections: named(cols),
        categories: named(cats),
        themes: named(thms),
        literaryMovements: named(litMvs),
        artTypes: named(artTps),
        artMovements: named(artMvs),
        keywords: named(kwds),
        attributes: named(attrs),
      });
    });
  }, [step, refDataLoaded, settingsLocationId]);

  return { recommenders, locations, lists, defaultLocationId };
}
