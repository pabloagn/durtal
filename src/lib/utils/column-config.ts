/**
 * A saved column choice and the table's columns today. A column added after
 * the choice was saved joins it, after the saved ones, visible when it is
 * visible by default (a new Roles column shows up instead of staying hidden
 * from the table and from its column dialog). A saved column the table no
 * longer has is dropped.
 */
export function withNewColumns<
  C extends { key: string; visible: boolean; order: number },
>(saved: C[], all: { key: string; defaultVisible: boolean; defaultOrder: number }[]): C[] {
  const known = new Set(all.map((c) => c.key));
  const kept = saved.filter((c) => known.has(c.key));
  const have = new Set(kept.map((c) => c.key));
  let next = Math.max(-1, ...kept.map((c) => c.order)) + 1;
  const added = all
    .filter((c) => !have.has(c.key))
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((c) => ({ key: c.key, visible: c.defaultVisible, order: next++ }) as C);
  return [...kept, ...added];
}
