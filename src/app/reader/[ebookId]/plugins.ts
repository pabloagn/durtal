import type { ComponentType, ReactNode } from "react";
import { createElement } from "react";

export interface ReaderPlugin {
  id: string;
  load?(context: { ebookId: string }): Promise<unknown>;
  Component: ComponentType<{ data: unknown }>;
}
/** The tracker adds its client component here in SLN-454. Loaders never enter the client bundle. */
export const readerPlugins: ReaderPlugin[] = [];

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
