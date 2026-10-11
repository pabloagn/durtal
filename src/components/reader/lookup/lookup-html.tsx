import { sanitizeLookupHtml } from "@/lib/reader/lookup/sanitize";
export function LookupHtml({ html, base, className = "" }: { html: string; base: string; className?: string }) {
  // Sanitise again at the render boundary, including session cache and pack parts.
  const marked = document.createElement("template");
  marked.innerHTML = sanitizeLookupHtml(html, { base });
  marked.content.querySelectorAll("a").forEach(link => {
    link.setAttribute("data-durtal-external", "");
    link.setAttribute("aria-description", "Opens in a new tab");
  });
  return <div className={"text-sm text-fg-primary [&_a]:text-accent-primary [&_a]:underline [&_a]:after:content-['↗'] [&_a]:after:ml-1 [&_p]:mb-2 [&_li]:ml-4 " + className}
    dangerouslySetInnerHTML={{ __html: marked.innerHTML }} />;
}
export function LookupSkeleton() {
  return <div role="status" aria-label="Looking up" data-lookup-skeleton className="space-y-3 py-2">
    <div className="h-3 w-4/5 rounded-sm bg-bg-tertiary" />
    <div className="h-3 w-full rounded-sm bg-bg-tertiary" />
    <div className="h-3 w-3/5 rounded-sm bg-bg-tertiary" />
  </div>;
}
export function LookupAttribution({ wiki, href, label }: { wiki: "Wiktionary" | "Wikipedia"; href: string; label: string }) {
  return <p className="mt-3 text-xs text-fg-secondary">From {wiki} · <a className="underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a> · <a className="underline" href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a></p>;
}
