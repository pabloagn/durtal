import Link from "next/link";

/** A row of linked tabs, one active: filters that live in the URL */
export function SegmentedLinks({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; active: boolean }[];
}) {
  return (
    <nav
      aria-label={label}
      className="inline-flex items-center rounded-sm border border-glass-border"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`inline-flex h-[26px] items-center px-3 text-xs transition-colors ${
            item.active
              ? "bg-accent-plum text-fg-primary"
              : "text-fg-muted hover:text-fg-secondary"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
