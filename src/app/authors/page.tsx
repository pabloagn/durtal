export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { getAuthors, getAuthorCount } from "@/lib/actions/authors";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

async function AuthorsContent({ search }: { search?: string }) {
  const authors = await getAuthors({ search });

  if (authors.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={search ? "No authors found" : "No authors yet"}
        description={
          search
            ? `No authors matching "${search}"`
            : "Authors are created when you add books"
        }
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Nationality</TableHead>
          <TableHead>Years</TableHead>
          <TableHead className="text-right">Works</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {authors.map((author) => (
          <TableRow key={author.id}>
            <TableCell>
              <Link
                href={`/authors/${author.id}`}
                className="font-serif text-fg-primary transition-colors hover:text-accent-rose"
              >
                {author.name}
              </Link>
              {author.sortName && author.sortName !== author.name && (
                <span className="ml-2 text-xs text-fg-muted">
                  ({author.sortName})
                </span>
              )}
            </TableCell>
            <TableCell className="text-fg-secondary">
              {author.nationality ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs text-fg-muted">
              {author.birthYear
                ? `${author.birthYear}–${author.deathYear ?? ""}`
                : "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-fg-secondary">
              {author.workAuthors.length}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function AuthorsPage({ searchParams }: PageProps) {
  const { q } = await searchParams;

  return (
    <>
      <PageHeader title="Authors" description="Browse all authors in your catalogue" />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <AuthorsContent search={q} />
      </Suspense>
    </>
  );
}
