import { permanentRedirect } from "next/navigation";
export default async function ReaderHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const q = (await searchParams).q;
  permanentRedirect(
    typeof q === "string" && q
      ? `/ebooks?${new URLSearchParams({ q })}`
      : "/ebooks",
  );
}
