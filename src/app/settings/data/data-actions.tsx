"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SettingRow, settingDescriptionId } from "@/components/settings/settings-group";
import {
  EXPORT_FORMAT_LABELS,
  triggerExport,
  type ExportFormat,
} from "@/components/shared/export-menu";
import { refreshCachedData } from "@/lib/actions/settings";

const FORMAT_OPTIONS = (Object.keys(EXPORT_FORMAT_LABELS) as ExportFormat[]).map((format) => ({
  value: format,
  label: EXPORT_FORMAT_LABELS[format],
}));

/** Every book or every author as one file, in the format picked beside it. */
export function ExportRow({
  entity,
  label,
  description,
}: {
  entity: "works" | "authors";
  label: string;
  description: string;
}) {
  const id = `export-${entity}`;
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);

  async function download() {
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

  return (
    <SettingRow id={id} label={label} description={description} stacked>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select
            id={id}
            value={format}
            options={FORMAT_OPTIONS}
            ariaDescribedby={settingDescriptionId(id)}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
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
