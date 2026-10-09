import type { ComponentType, ReactNode } from "react";
import { createElement } from "react";
import { ReaderTracking, ReaderTrackingFailure } from "@/components/reading/reader-tracking";
import { loadReaderTracking } from "@/lib/reading/reader";
import { READER_TRACKING_CONTROLLER_ID } from "@/lib/reading/reader-controller";

export interface ReaderPlugin {
  id: string;
  load?(context: { ebookId: string }): Promise<unknown>;
  Component: ComponentType<{ data: unknown }>;
}
/** The readiness fields are consumed by the shared controller loader (SLN-493). */
const readingTrackerPlugin = {
  id: READER_TRACKING_CONTROLLER_ID,
  load: loadReaderTracking,
  Component: ReaderTracking,
  controller: true as const,
  Failure: ReaderTrackingFailure,
};
export const readerPlugins: ReaderPlugin[] = [readingTrackerPlugin];

export async function loadReaderPlugins(
  context: { ebookId: string },
  plugins = readerPlugins,
): Promise<{ id: string; node: ReactNode }[]> {
  const results = await Promise.allSettled(
    plugins.map(async (plugin) => {
      const value = plugin.load
        ? await plugin.load({ ebookId: context.ebookId })
        : null;
      const json = JSON.stringify(value ?? null, (_key, item) => {
        if (
          typeof item === "function" ||
          typeof item === "symbol" ||
          typeof item === "bigint"
        )
          throw new Error("Reader plug-in data must be serialisable");
        return item;
      });
      return {
        id: plugin.id,
        node: createElement(plugin.Component, { data: JSON.parse(json) }),
      };
    }),
  );
  return results.flatMap((result, at) => {
    if (result.status === "fulfilled") return [result.value];
    console.error(
      `[reader] Plug-in ${plugins[at].id} failed to load:`,
      result.reason,
    );
    return [];
  });
}
