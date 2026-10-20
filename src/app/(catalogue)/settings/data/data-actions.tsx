"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SettingRow, settingDescriptionId } from "@/components/settings/settings-group";
import { Dialog } from "@/components/ui/dialog";
import {
  EXPORT_FORMAT_LABELS,
  exportFormatName,
  exportFormats,
  triggerExport,
  goodreadsWarning,
  type ExportEntity,
  type ExportFormat,
} from "@/components/shared/export-menu";
import { refreshCachedData } from "@/lib/actions/settings";
import { getGoodreadsExportNotice } from "@/lib/actions/reading-export";

/** "books" for "Books", inside a sentence; a name such as Goodreads keeps its capital (SLN-924) */
function inSentence(label: string) {
  return /^Goodreads\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** Every record of one kind as one file, in the format picked beside it. */
export function ExportRow({
  entity,
  label,
  description,
}: {
  entity: ExportEntity;
  label: string;
  description: string;
}) {
  const id = `export-${entity}`;
  const formats = exportFormats(entity);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  /** The Goodreads file's half stars, said before it downloads */
  const [notice, setNotice] = useState<{ halfStars: number; unresolvedIds: number } | null>(null);

  async function save() {
    setExporting(true);
    const progress = toast.pending(`Exporting ${inSentence(label)}`);
    try {
      const result = await triggerExport(entity, "all", format);
      if (result.unresolvedIds) progress.warning(goodreadsWarning(result.unresolvedIds));
      else progress.success(`${label} exported as ${exportFormatName(format)}`);
    } catch (error) {
      progress.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function download() {
    if (entity !== "goodreads") return save();
    setExporting(true);
    try {
      const notice = await getGoodreadsExportNotice();
      if (notice.halfStars > 0) return setNotice(notice);
    } catch {
      // The count is a courtesy: the file still downloads
    } finally {
      setExporting(false);
    }
    await save();
  }

  return (
    <SettingRow id={id} label={label} description={description} stacked>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select
            id={id}
            value={format}
            options={formats.map((f) => ({ value: f, label: EXPORT_FORMAT_LABELS[f] }))}
            ariaDescribedby={settingDescriptionId(id)}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
            disabled={formats.length === 1}
          />
        </div>
        <Button
          onClick={download}
          busy={exporting}
          aria-label={`Download ${inSentence(label)}`}
        >
          <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          Download
        </Button>
      </div>
      <Dialog
        open={notice !== null}
        onClose={() => setNotice(null)}
        title="Export for Goodreads"
        className="max-w-md"
        expandable={false}
      >
        <div className="space-y-4" data-goodreads-notice="">
          {!!notice?.halfStars && <p className="text-sm text-fg-secondary">
            {notice.halfStars === 1 ? "1 half-star rating will be rounded up" : `${notice.halfStars} half-star ratings will be rounded up`}: Goodreads
            takes whole stars. Durtal keeps your ratings as they are.
          </p>}
          {!!notice?.unresolvedIds && <p className="text-sm text-fg-secondary">
            {notice.unresolvedIds} unresolved Goodreads Book {notice.unresolvedIds === 1 ? "Id will" : "Ids will"} be left blank.
          </p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setNotice(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              data-shortcut="save"
              onClick={() => {
                setNotice(null);
                void save();
              }}
            >
              Download
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingRow>
  );
}

/** Drop every cached list, so the next page reads the database again. */
export function RefreshCacheRow() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      try {
        const result = await refreshCachedData();
        toast.success(`Cached data refreshed (${result.tags} lists)`);
        router.refresh();
      } catch {
        toast.error("Could not refresh the cached data. Try again.");
      }
    });
  }

  return (
    <SettingRow
      id="refresh-cache"
      label="Refresh cached data"
      description="Locations, taxonomy, recommenders and other lists are kept for up to an hour. Refresh them after a change made outside the app, such as a script."
    >
      <Button
        id="refresh-cache"
        onClick={refresh}
        busy={pending}
        aria-describedby={settingDescriptionId("refresh-cache")}
      >
        <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        Refresh
      </Button>
    </SettingRow>
  );
}
