"use client";

import { useState } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";

/** A credited person as the page lists them */
export interface CreditView {
  id: string;
  /** Their filtered film home: directors and cast who name a person */
  href: string | null;
  name: string;
  /** Neither a person nor a credited name: "Unknown", "Anonymous" */
  unnamed: boolean;
  /** The name on screen, when it differs */
  creditedAs: string | null;
  characters: string[];
}

/** Cast lists longer than this show their first names and "Show all" */
const SHOWN = 12;

/** A name, linked to the films it filters when it has a link */
export function CreditName({ credit }: { credit: CreditView }) {
  if (credit.href)
    return (
      <Link href={credit.href} className="transition-colors hover:text-accent-primary">
        {credit.name}
      </Link>
    );
  return credit.unnamed ? (
    <span className="text-fg-secondary">{credit.name}</span>
  ) : (
    <>{credit.name}</>
  );
}

/**
 * The cast in billing order, each with the characters they play. A long cast
 * shows its first twelve until it is opened.
 */
export function CastSection({ cast }: { cast: CreditView[] }) {
  const [open, setOpen] = useState(false);
  if (!cast.length) return null;
  const shown = open ? cast : cast.slice(0, SHOWN);
  return (
    <section className="mb-10" aria-labelledby="film-cast">
      <SectionHeading id="film-cast" title="Cast" count={cast.length} />
      <ul id="film-cast-list" className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {shown.map((credit) => (
          <li key={credit.id} className="min-w-0">
            <p className="text-sm text-fg-primary">
              <CreditName credit={credit} />
            </p>
            {(credit.characters.length > 0 || credit.creditedAs) && (
              <p className="text-xs text-fg-secondary">
                {[
                  credit.characters.length ? `as ${credit.characters.join(" / ")}` : null,
                  credit.creditedAs ? `credited as ${credit.creditedAs}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
      {cast.length > SHOWN && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          aria-expanded={open}
          aria-controls="film-cast-list"
          onClick={() => setOpen(!open)}
        >
          {open ? "Show fewer" : `Show all ${cast.length}`}
        </Button>
      )}
    </section>
  );
}

/** The crew by role, in the order the credits read */
export function CrewSection({
  crew,
}: {
  crew: { roleId: string; heading: string; people: CreditView[] }[];
}) {
  if (!crew.length) return null;
  return (
    <section className="mb-10" aria-labelledby="film-crew">
      <SectionHeading id="film-crew" title="Crew" />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        {crew.map((role) => (
          <div key={role.roleId} className="contents">
            <dt className="text-fg-secondary">{role.heading}</dt>
            <dd className="text-fg-primary">
              {role.people.map((person, i) => (
                <span key={person.id}>
                  {i > 0 && ", "}
                  <CreditName credit={person} />
                  {person.creditedAs && (
                    <span className="text-fg-secondary"> (as {person.creditedAs})</span>
                  )}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
