import type { ReactNode } from "react";
// Publisher identities, favourites, and acquisition state must reflect current catalogue data.
export const dynamic = "force-dynamic";
export default function PublishersLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
