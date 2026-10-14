import { furthestOffer, placeToOffer, type ReaderPlace } from "./places";

/** One reader open: local intent invalidates even a response already in flight. */
export function createPlaceSync(options: {
  own: ReaderPlace | null;
  other: ReaderPlace | null;
  /** Every other device's place when the page has them, for the furthest */
  others?: readonly ReaderPlace[];
  declinedAt: number;
  flush: () => Promise<boolean>;
  read: () => Promise<ReaderPlace[]>;
  /** The newest other place, and the furthest when it is further still */
  offer: (place: ReaderPlace | null, furthest?: ReaderPlace | null) => void;
  remember: (at: number) => void;
}) {
  let own = options.own;
  let current: ReaderPlace | null = null;
  let declinedAt = options.declinedAt;
  let generation = 0;
  let pending: Promise<void> | null = null;
  let destroyed = false;
  const apply = (others: ReaderPlace[]) => {
    const offer = placeToOffer(own, others);
    current =
      offer && Date.parse(offer.clientUpdatedAt) > declinedAt ? offer : null;
    options.offer(current, furthestOffer(own, others, current));
  };
  apply(options.others?.length ? [...options.others] : options.other ? [options.other] : []);
  const dismiss = () => {
    generation++;
    if (current) {
      declinedAt = Math.max(declinedAt, Date.parse(current.clientUpdatedAt));
      options.remember(declinedAt);
    }
    current = null;
    options.offer(null);
  };
  return {
    localTurn(place: ReaderPlace) {
      own = place;
      dismiss();
    },
    localPlace(place: ReaderPlace) {
      own = place;
    },
    dismiss,
    refresh(): Promise<void> {
      if (destroyed) return Promise.resolve();
      if (pending) return pending;
      const expected = generation;
      pending = (async () => {
        try {
          if (!(await options.flush()) || destroyed || expected !== generation)
            return;
          const places = await options.read();
          if (!destroyed && expected === generation)
            apply(places.filter((place) => !place.thisDevice));
        } catch {
          // A failed refresh leaves the book and its current place usable.
        }
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
    destroy() {
      destroyed = true;
      generation++;
    },
  };
}
