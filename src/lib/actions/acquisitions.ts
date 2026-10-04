"use server";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import {
  acquisitionTargets,
  artObjects,
  countries,
  filmReleases,
  filmVersions,
  orders,
  perfumeVariants,
  works,
} from "@/lib/db/schema";
import { targetState } from "@/lib/publishers/conditions";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { withReadableErrors } from "@/lib/db/errors";
import { createOrder } from "@/lib/actions/orders";
import { typedKind } from "@/lib/catalogue/acquisition-receipt";
import { orderCost, targetTitle, type TargetState } from "@/lib/catalogue/acquisition-labels";
import {
  typedOrderSchema,
  typedTargetSchema,
  type TypedOrderInput,
  type TypedTargetInput,
} from "@/lib/validations/acquisitions";
import type { OrderStatus } from "@/lib/constants/orders";

/*
 * Acquisition targets for films, perfumes and paintings (SLN-374): what the
 * collector wants to buy, and the orders that buy it. A book's targets keep
 * their own services (publishers).
 */

export interface TypedTargetView {
  id: string;
  /** "Eau de Parfum · Bottle · 50 ml" */
  title: string;
  state: TargetState;
  /** Where it will be kept: a film copy may be digital */
  medium: "physical" | "digital";
  orders: {
    id: string;
    status: OrderStatus;
    orderDate: string;
    /** "€120.00" */
    cost: string | null;
    received: boolean;
  }[];
}

const reproduced = alias(artObjects, "reproduced");

/** A work's open film, perfume or painting targets, oldest first, with their orders */
export async function getTypedTargets(workId: string): Promise<TypedTargetView[]> {
  z.uuid().parse(workId);
  const rows = await db
    .select({
      target: acquisitionTargets,
      state: targetState,
      variant: perfumeVariants,
      version: filmVersions,
      release: filmReleases,
      countryName: countries.name,
      object: artObjects,
      reproduced,
    })
    .from(acquisitionTargets)
    .leftJoin(perfumeVariants, eq(perfumeVariants.id, acquisitionTargets.perfumeVariantId))
    .leftJoin(filmVersions, eq(filmVersions.id, acquisitionTargets.filmVersionId))
    .leftJoin(filmReleases, eq(filmReleases.id, acquisitionTargets.filmReleaseId))
    .leftJoin(countries, eq(countries.id, filmReleases.countryId))
    .leftJoin(artObjects, eq(artObjects.id, acquisitionTargets.artObjectId))
    .leftJoin(reproduced, eq(reproduced.id, acquisitionTargets.artReproducesObjectId))
    .where(
      and(
        eq(acquisitionTargets.workId, workId),
        eq(acquisitionTargets.isCancelled, false),
        sql`num_nonnulls(${acquisitionTargets.perfumeVariantId}, ${acquisitionTargets.filmVersionId}, ${acquisitionTargets.artObjectId}, ${acquisitionTargets.artReproducesObjectId}) > 0`,
      ),
    )
    .orderBy(asc(acquisitionTargets.createdAt), asc(acquisitionTargets.id));
  const linked = rows.length
    ? await db
        .select({
          id: orders.id,
          targetId: orders.acquisitionTargetId,
          status: orders.status,
          orderDate: orders.orderDate,
          totalCost: orders.totalCost,
          price: orders.price,
          currency: orders.currency,
          received: sql<boolean>`num_nonnulls(${orders.filmHoldingId}, ${orders.perfumeBottleId}, ${orders.artObjectId}) > 0`,
        })
        .from(orders)
        .where(inArray(orders.acquisitionTargetId, rows.map((r) => r.target.id)))
        .orderBy(desc(orders.orderDate), desc(orders.createdAt))
    : [];
  return rows.map(({ target: t, state, variant, version, release, countryName, object, reproduced: original }) => ({
    id: t.id,
    title: targetTitle({
      perfume: variant
        ? {
            concentration: variant.concentration,
            concentrationLabel: variant.concentrationLabel,
            formulationLabel: variant.formulationLabel,
            container: t.perfumeContainer!,
            capacityValue: Number(t.perfumeCapacityValue),
            volumeUnit: t.perfumeVolumeUnit!,
          }
        : null,
      film: version
        ? {
            versionLabel: version.label,
            release: release
              ? { format: release.format, countryName, territoryLabel: release.territoryLabel }
              : null,
            medium: t.filmMedium!,
            formatLabel: t.filmFormatLabel,
          }
        : null,
      painting:
        object || original
          ? { reproduction: !object, object: { kind: (object ?? original)!.kind, label: (object ?? original)!.label } }
          : null,
    }),
    state: state as TargetState,
    medium: t.filmMedium ?? "physical",
    orders: linked
      .filter((o) => o.targetId === t.id)
      .map((o) => ({
        id: o.id,
        status: o.status as OrderStatus,
        orderDate: o.orderDate,
        cost: orderCost(o.totalCost, o.price, o.currency),
        received: o.received,
      })),
  }));
}

/**
 * Adds a target: a formulation in a container size, a film version (and
 * release) on a medium, or a painting's object or a reproduction of it.
 * The database checks that each belongs to the work.
 */
export async function createTypedTarget(input: TypedTargetInput) {
  const data = typedTargetSchema.parse(input);
  const [work] = await db.select({ kind: works.kind }).from(works).where(eq(works.id, data.workId));
  if (!work) throw new Error("This record no longer exists");
  if (work.kind !== data.kind) throw new Error(`This is not a ${data.kind}`);
  const values =
    data.kind === "perfume"
      ? {
          workId: data.workId,
          perfumeVariantId: data.variantId,
          perfumeContainer: data.container,
          perfumeCapacityValue: data.capacityValue,
          perfumeVolumeUnit: data.volumeUnit,
        }
      : data.kind === "film"
        ? {
            workId: data.workId,
            filmVersionId: data.versionId,
            filmReleaseId: data.releaseId ?? null,
            filmMedium: data.medium,
            filmFormatLabel: data.formatLabel ?? null,
          }
        : data.reproduction
          ? { workId: data.workId, artReproducesObjectId: data.objectId }
          : { workId: data.workId, artObjectId: data.objectId };
  const [row] = await withReadableErrors(() =>
    db.insert(acquisitionTargets).values(values).onConflictDoNothing().returning(),
  );
  if (!row) throw new Error("This is already on your list");
  invalidate(CACHE_TAGS.works);
  return row;
}

/** Removes a target with no open order; a received one stays as a record */
export async function removeTypedTarget(id: string) {
  z.uuid().parse(id);
  const [row] = await withReadableErrors(() =>
    db
      .update(acquisitionTargets)
      .set({ isCancelled: true })
      .where(and(eq(acquisitionTargets.id, id), sql`num_nonnulls(${acquisitionTargets.perfumeVariantId}, ${acquisitionTargets.filmVersionId}, ${acquisitionTargets.artObjectId}, ${acquisitionTargets.artReproducesObjectId}) > 0`))
      .returning(),
  );
  if (!row) throw new Error("This target no longer exists");
  invalidate(CACHE_TAGS.works);
}

/**
 * Orders what a target names. Bought in a shop or received as a gift, it
 * arrives at once: the bottle, copy or object is created with the order.
 */
export async function orderTypedTarget(input: TypedOrderInput) {
  const data = typedOrderSchema.parse(input);
  const [target] = await db.select().from(acquisitionTargets).where(eq(acquisitionTargets.id, data.targetId));
  if (!target || target.isCancelled || !typedKind(target)) throw new Error("This target no longer exists");
  const { targetId, ...order } = data;
  return createOrder({ ...order, workId: target.workId, acquisitionTargetId: targetId });
}
