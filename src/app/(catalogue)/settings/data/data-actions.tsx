"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SettingRow, settingDescriptionId } from "@/components/settings/settings-group";
import { Dialog } from "@/components/ui/dialog";
import {
  EXPORT_FORMAT_LABELS,
  exportFormats,
  triggerExport,
  type ExportEntity,
  type ExportFormat,
} from "@/components/shared/export-menu";
import { refreshCachedData } from "@/lib/actions/settings";
import { getGoodreadsExportNotice } from "@/lib/actions/reading-export";

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
  const [halfStars, setHalfStars] = useState<number | null>(null);

  async function save() {
    setExporting(true);
    try {
      await triggerExport(entity, "all", format);
      toast.success(`${label} exported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function download() {
    if (entity !== "goodreads") return save();
    setExporting(true);
    try {
      const notice = await getGoodreadsExportNotice();
      if (notice.halfStars > 0) return setHalfStars(notice.halfStars);
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
          disabled={exporting}
          aria-label={`Download ${label.toLowerCase()}`}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden />
          ) : (
            <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          )}
          Download
        </Button>
      </div>
      <Dialog
        open={halfStars !== null}
        onClose={() => setHalfStars(null)}
        title="Export for Goodreads"
        className="max-w-md"
        expandable={false}
      >
        <div className="space-y-4" data-goodreads-notice="">
          <p className="text-sm text-fg-secondary">
            {halfStars === 1 ? "1 half-star rating will be rounded up" : `${halfStars} half-star ratings will be rounded up`}: Goodreads
            takes whole stars. Durtal keeps your ratings as they are.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setHalfStars(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              data-shortcut="save"
              onClick={() => {
                setHalfStars(null);
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
        disabled={pending}
        aria-describedby={settingDescriptionId("refresh-cache")}
      >
        <RefreshCw
          className={`h-4 w-4 ${pending ? "motion-safe:animate-spin" : ""}`}
          strokeWidth={1.5}
          aria-hidden
        />
        Refresh
      </Button>
    </SettingRow>
  );
}
