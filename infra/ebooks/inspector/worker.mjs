// The image's entrypoint, as written: plain JavaScript that loads the worker
// build.mjs compiled to /inspector/inspector.mjs. Root builds and installs
// this separate image after review. No app autostart.
// The environment as the container started, before sharp loads: libvips then
// adds VIPSHOME, which is not something the container inherited.
const inherited = Object.keys(process.env);
try {
  const { runInspectorWorker } = await import("./inspector.mjs");
  await runInspectorWorker(inherited);
} catch (error) {
  const message = error instanceof Error ? error.message : "Inspector attempt failed";
  process.stderr.write(`${message.replace(/[\r\n]/g, " ").slice(0, 1024)}\n`);
  process.exitCode = 1;
}
// All source/derived handles and stdout writes have settled. As container PID 1,
// exit also makes Linux reap any children in this owned tree.
process.exit(process.exitCode ?? 0);
