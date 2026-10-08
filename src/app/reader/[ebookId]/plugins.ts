/**
 * What other features add to the reader page (eBooks sub-issue 3): each
 * plug-in's `load` runs on the server in parallel with the page's query, and
 * its result is handed to the reading view under the plug-in's id. Empty in
 * this sub-issue; sub-issue 4 adds the reading tracker's bridge (SLN-454).
 */

export interface ReaderPluginContext {
  ebookId: string;
  /** The file asked for with `?file=`, if any */
  fileId: string | null;
  deviceId: string | null;
}

export interface ReaderPlugin {
  id: string;
  load(context: ReaderPluginContext): Promise<unknown>;
}

export const readerPlugins: ReaderPlugin[] = [];

/** Every plug-in's data by id; one that fails is left out, and the book still opens */
export async function loadReaderPlugins(context: ReaderPluginContext): Promise<Record<string, unknown>> {
  const results = await Promise.allSettled(readerPlugins.map((plugin) => plugin.load(context)));
  return Object.fromEntries(
    results.flatMap((result, at) => {
      if (result.status === "fulfilled") return [[readerPlugins[at].id, result.value]];
      console.error(`[reader] Plug-in ${readerPlugins[at].id} failed to load:`, result.reason);
      return [];
    }),
  );
}
