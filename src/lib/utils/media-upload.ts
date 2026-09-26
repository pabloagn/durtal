/** Only retry a rejection explicitly issued before any upload side effects. */
export async function uploadMediaFile(makeBody: () => FormData): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("/api/media/upload", {
      method: "POST",
      body: makeBody(),
    });
    if (response.ok) return;
    const body = await response.json().catch(() => null);
    if (
      attempt === 0 &&
      response.status === 400 &&
      body?.code === "INVALID_MULTIPART"
    )
      continue;
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Image upload failed (${response.status}).`,
    );
  }
}

export async function mediaResponseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(
    typeof body?.error === "string"
      ? body.error
      : `Image upload failed (${response.status}).`,
  );
}
