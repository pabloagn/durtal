/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("@/lib/env");
    // Fail at startup, not at the first request that needs a variable.
    const env = serverEnv();
    if (env.EBOOK_UPLOAD_BRIDGE) {
      const { installUploadAppBridgeFromFile } = await import("@/lib/ebooks/upload-core/app-bridge");
      // A broken bridge leaves uploads off (503) and the rest of the app up.
      await installUploadAppBridgeFromFile(env.EBOOK_UPLOAD_BRIDGE).catch((error: unknown) => {
        console.error(`E-book uploads are off: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
}
