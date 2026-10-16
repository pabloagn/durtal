/** Why a name-dependent save is unavailable; kept beside the action. */
export function RequiredNameHint({
  value,
  message,
}: {
  value: string;
  message: string;
}) {
  return value.trim() ? null : (
    <p className="mr-auto text-xs text-fg-secondary">{message}</p>
  );
}
