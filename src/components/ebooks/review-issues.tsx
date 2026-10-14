import type { ReviewPreparationIssue } from "@/lib/ebooks/review-queue/types";

export function ReviewIssues({ issues, titles }: { issues: readonly ReviewPreparationIssue[]; titles?: ReadonlyMap<string, string> }) {
  // One line per message: the same refusal for several fields reads once
  const seen = new Set<string>();
  issues = issues.filter((issue) => { const key = `${issue.ebookId}:${issue.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
  if (!issues.length) return null;
  return <ul aria-label="Choices to complete" className="space-y-1 rounded-sm border border-accent-red-text/30 p-3 text-sm text-accent-red-text">
    {issues.map((issue, index) => <li key={`${issue.ebookId}:${issue.code}:${index}`}>
      {titles?.get(issue.ebookId) ? `${titles.get(issue.ebookId)} · ` : ""}{issue.message}
    </li>)}
  </ul>;
}
