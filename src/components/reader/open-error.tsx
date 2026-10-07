import { SectionHeading } from "@/components/shared/section-heading";
import { Button, buttonClass } from "@/components/ui/button";

/**
 * When a book does not open (eBooks sub-issue 3): what went wrong in plain
 * words, Retry, the book's other readable files, and the way back. Never an
 * endless spinner.
 */
export function OpenError({
  title = "This eBook could not be opened",
  message,
  onRetry,
  alternatives,
  ebookId,
  backHref,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  alternatives: { id: string; label: string }[];
  ebookId: string;
  backHref: string;
}) {
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md">
        <SectionHeading title={title} description={message} />
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button variant="primary" onClick={onRetry}>
              Retry
            </Button>
          )}
          {alternatives.map((file) => (
            <a key={file.id} href={`/reader/${ebookId}?file=${file.id}`} className={buttonClass("secondary")}>
              Open the {file.label} instead
            </a>
          ))}
          <a href={backHref} className={buttonClass("ghost")}>
            Back
          </a>
        </div>
      </div>
    </div>
  );
}
