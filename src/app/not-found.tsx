import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="mb-5 rounded-sm border border-glass-border bg-bg-secondary/50 p-3.5">
        <svg className="h-6 w-6 text-fg-muted" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m3 12.5 5 5"/><path d="m8 12.5-5 5"/></svg>
      </div>
      <h2 className="font-serif text-xl text-fg-primary">Page not found</h2>
      <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-fg-secondary">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center rounded-sm border border-glass-border bg-bg-secondary px-4 py-1.5 text-sm text-fg-primary transition-colors hover:bg-bg-tertiary"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
