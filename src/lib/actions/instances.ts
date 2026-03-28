"use server";

import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createInstanceSchema,
  type CreateInstanceInput,
} from "@/lib/validations";

export async function createInstance(input: CreateInstanceInput) {
  const parsed = createInstanceSchema.parse(input);
  const [instance] = await db.insert(instances).values(parsed).returning();
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
  return { id };
}

export async function deleteInstance(id: string) {
  await db.delete(instances).where(eq(instances.id, id));
  return { id };
}
