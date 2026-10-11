import { PageHeader } from "@/components/layout/page-header";
import { FilmForm } from "@/components/films/film-form";
import { getFilmChoices } from "@/lib/actions/films";

export const metadata = { title: "Add Film" };

/** A new film by hand; its versions, releases and copies are added on its page. */
export default async function AddFilmPage() {
  const choices = await getFilmChoices();
  return (
    <>
      <PageHeader
        title="Add film"
        description="The film first; its versions, releases and copies go on its page"
      />
      <div className="max-w-3xl">
        <FilmForm mode="create" choices={choices} />
      </div>
    </>
  );
}
