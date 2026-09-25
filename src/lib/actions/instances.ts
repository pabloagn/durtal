"use server";

import { db } from "@/lib/db";
import { editions, instances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createInstanceSchema,
  type CreateInstanceInput,
} from "@/lib/validations";
import { recordActivity } from "@/lib/activity/record";
import { updateInstanceSchema, type UpdateInstanceInput } from "@/lib/validations/instances";
import { parseId } from "@/lib/validations/helpers";

export async function createInstance(input: CreateInstanceInput) {
  const parsed = createInstanceSchema.parse(input);
  const [instance] = await db.insert(instances).values(parsed).returning();

  const edition = await db.query.editions.findFirst({
    where: eq(editions.id, parsed.editionId),
    columns: { workId: true },
  });
  if (edition) {
    recordActivity("work", edition.workId, "work.instance_added", {
      targetId: instance.id,
    });
  }

  return instance;
}

export async function updateInstance(
  id: string,
  input: UpdateInstanceInput,
) {
  parseId(id);
  const data = updateInstanceSchema.parse(input);
  await db
    .update(instances)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(instances.id, id));

  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, id),
    columns: { id: true },
    with: {
      edition: {
        columns: { workId: true },
      },
    },
  });
  if (inst?.edition) {
    recordActivity("work", inst.edition.workId, "work.instance_updated", {
      targetId: id,
    });
  }

  return { id };
}

export async function deleteInstance(id: string) {
  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, id),
    columns: { id: true },
    with: {
      edition: {
        columns: { workId: true },
      },
    },
  });

  await db.delete(instances).where(eq(instances.id, id));

  if (inst?.edition) {
    recordActivity("work", inst.edition.workId, "work.instance_deleted", {
      targetId: id,
    });
  }

  return { id };
}
