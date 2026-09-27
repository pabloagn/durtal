import { Skull } from "lucide-react";
import { POISON_HINT, POISON_LABEL } from "@/lib/constants/poison";

/** Skull shown on poison works, styled like the rare gem (`HuntBadge`). */
export function PoisonBadge({
  isPoison,
  cover = false,
}: {
  isPoison?: boolean;
  cover?: boolean;
}) {
  if (!isPoison) return null;
  const label = `${POISON_LABEL} · ${POISON_HINT}`;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center text-accent-red ${cover ? "h-4 w-4 rounded-[2px] border border-white/15 bg-black/50 backdrop-blur-md @[220px]:h-5 @[220px]:w-5" : ""}`}
      title={label}
      role="img"
      aria-label={label}
    >
      <Skull
        className={
          cover ? "h-2.5 w-2.5 @[220px]:h-3.5 @[220px]:w-3.5" : "h-3.5 w-3.5"
        }
        strokeWidth={1.5}
        fill="currentColor"
        fillOpacity={0.18}
        aria-hidden="true"
      />
    </span>
  );
}
