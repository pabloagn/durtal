import { notFound } from "next/navigation";
import { reviewYearExists } from "@/lib/catalogue/record-exists";

export default async function YearInReviewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ year: string }>;
}) {
  // Before the loading screen starts the response, so a year with no finished book answers 404
  if (!(await reviewYearExists((await params).year))) notFound();
  return children;
}
