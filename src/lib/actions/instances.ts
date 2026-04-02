"use server";

import { db } from "@/lib/db";
import { editions, instances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createInstanceSchema,
  type CreateInstanceInput,
} from "@/lib/validations";
import { recordActivity } from "@/lib/activity/record";

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
  input: Partial<CreateInstanceInput>,
) {
  await db
    .update(instances)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(instances.id, id));

  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, id),
    columns: { editionId: true },
  });
  if (inst) {
    const edition = await db.query.editions.findFirst({
      where: eq(editions.id, inst.editionId),
      columns: { workId: true },
    });
    if (edition) {
      recordActivity("work", edition.workId, "work.instance_updated", {
        targetId: id,
      });
    }
  }

  return { id };
}

export async function deleteInstance(id: string) {
  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, id),
    columns: { editionId: true },
  });

  await db.delete(instances).where(eq(instances.id, id));

  if (inst) {
    const edition = await db.query.editions.findFirst({
      where: eq(editions.id, inst.editionId),
      columns: { workId: true },
    });
    if (edition) {
      recordActivity("work", edition.workId, "work.instance_deleted", {
        targetId: id,
      });
    }
  }

  return { id };
}
