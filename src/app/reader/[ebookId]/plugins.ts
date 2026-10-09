import type { ComponentType } from "react";
import { createElement } from "react";
import type { ReaderControllerFailureProps, ReaderPluginView } from "@/lib/reader/bridge-state";

export interface ReaderPlugin {
  id: string;
  load?(context: { ebookId: string }): Promise<unknown>;
  Component: ComponentType<{ data: unknown }>;
  /** Eager functional subscriber; secondary UI may still be lazy. */
  controller?: true;
  Failure?: ComponentType<ReaderControllerFailureProps>;
}
/** The tracker adds its client component here in SLN-454. Loaders never enter the client bundle. */
export const readerPlugins: ReaderPlugin[] = [];

export function getRequiredReaderControllerIds(plugins = readerPlugins): readonly string[] {
  const ids = plugins.map((plugin) => plugin.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    throw new Error("Reader plugin IDs must be unique and nonempty");
  for (const plugin of plugins)
    if (plugin.controller && !plugin.Failure)
      throw new Error(`Reader controller requires an eager failure surface: ${plugin.id}`);
  return plugins.filter((plugin) => plugin.controller).map((plugin) => plugin.id);
}

export async function loadReaderPlugins(
  context: { ebookId: string },
  plugins = readerPlugins,
): Promise<ReaderPluginView[]> {
  getRequiredReaderControllerIds(plugins); // Configuration, never successful loads, owns the required set.
  const results = await Promise.allSettled(
    plugins.map(async (plugin) => {
      const value = plugin.load
        ? await plugin.load({ ebookId: context.ebookId })
        : null;
      const json = JSON.stringify(value ?? null, (_key, item) => {
        if (typeof item === "function" || typeof item === "symbol" || typeof item === "bigint")
          throw new Error("Reader plug-in data must be serialisable");
        return item;
      });
      return { id: plugin.id, node: createElement(plugin.Component, { data: JSON.parse(json) }) };
    }),
  );
  return results.flatMap((result, at): ReaderPluginView[] => {
    const plugin = plugins[at];
    const controller = plugin.controller ? {
      controller: true as const,
      failureNode: createElement(plugin.Failure!, { id: plugin.id, code: "reader_controller_unavailable" as const }),
    } : {};
    if (result.status === "fulfilled") return [{ ...result.value, ...controller }];
    console.error(`[reader] Plug-in ${plugin.id} failed to load:`, result.reason);
    return plugin.controller
      ? [{ id: plugin.id, node: null, ...controller, failure: "reader_controller_load_failed" }]
      : [];
  });
}
