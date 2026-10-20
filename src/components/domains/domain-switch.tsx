import Link from "next/link";
import { DOMAIN_ORDER, WORK_DOMAINS } from "@/lib/catalogue/domains";
import { domainSwitchHref } from "@/lib/catalogue/domain-switch";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Links between the homes of the collections. Each link keeps only the
 * search, filters and sort that its home understands. With one open
 * collection there is nothing to switch to, so it renders nothing.
 */
export function DomainSwitch({
  current,
  searchParams,
}: {
  current: WorkKind;
  searchParams: SearchParams;
}) {
  const kinds = DOMAIN_ORDER;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  return (
    <nav aria-label="Collections" className="@container mt-6 max-sm:mt-4">
      {/* On a phone one row of tabs without icons, equal where the row has
          room and each as wide as its label where it has not; a row too
          narrow for four labels (about 330px) takes two rows of two, so
          none is cut (SLN-879), and anything narrower still scrolls inside
          itself, never the page (SLN-639) */}
      <ul className={`flex flex-wrap gap-1 pointer-coarse:gap-2 max-sm:flex-nowrap max-sm:overflow-x-auto ${kinds.length > 3 ? "max-sm:@max-[21rem]:grid max-sm:@max-[21rem]:grid-cols-2" : ""}`}>
        {kinds.map((kind) => {
          const Icon = DOMAIN_ICONS[kind];
          const active = kind === current;
          return (
            <li key={kind} className="max-sm:flex-1">
              <Link
                href={domainSwitchHref(kind, params)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-8 items-center gap-2 rounded-sm border px-3 text-sm transition-colors pointer-coarse:h-11 max-sm:w-full max-sm:justify-center max-sm:px-2 ${
                  active
                    ? "border-accent-primary/10 bg-selection-bg/80 text-fg-primary"
                    : "border-transparent text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 max-sm:hidden" strokeWidth={1.5} />
                {WORK_DOMAINS[kind].pluralLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
