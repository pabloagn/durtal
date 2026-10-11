import { register } from "tsx/esm/api";

// Root builds and installs this separate image after review. No app autostart.
const unregister = register({ tsconfig: "/inspector/tsconfig.json" });
try {
  const { runInspectorWorker } = await import("./src/lib/ebooks/upload/worker-entry.ts");
  await runInspectorWorker();
} catch (error) {
  const message = error instanceof Error ? error.message : "Inspector attempt failed";
  process.stderr.write(`${message.replace(/[\r\n]/g, " ").slice(0, 1024)}\n`);
  process.exitCode = 1;
} finally {
  await unregister();
}
// All source/derived handles and stdout writes have settled. As container PID 1,
// exit also makes Linux reap any loader/compiler children in this owned tree.
process.exit(process.exitCode ?? 0);
