import Link from "next/link";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { domainSwitchHref } from "@/lib/catalogue/domain-switch";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Links between the homes of the open collections. Each link keeps only the
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
  const kinds = getEnabledWorkKinds();
  if (kinds.length < 2) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  return (
    <nav aria-label="Collections" className="mt-6">
      <ul className="flex flex-wrap gap-1">
        {kinds.map((kind) => {
          const Icon = DOMAIN_ICONS[kind];
          const active = kind === current;
          return (
            <li key={kind}>
              <Link
                href={domainSwitchHref(kind, params)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-8 items-center gap-2 rounded-sm border px-3 text-sm transition-colors ${
                  active
                    ? "border-accent-rose/10 bg-accent-plum/80 text-fg-primary"
                    : "border-transparent text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                {WORK_DOMAINS[kind].pluralLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
