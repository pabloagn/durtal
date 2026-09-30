import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod/v4";

// A rejected payload must fail before either reading or writing the database.
const { databaseAccess } = vi.hoisted(() => ({
  databaseAccess: vi.fn(() => {
    throw new Error("Unexpected database access");
  }),
}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: databaseAccess }) }));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  CACHE_TAGS: {},
  cached: (fn: unknown) => fn,
}));
import { createWork, updateWork } from "@/lib/actions/works";
import type { CreateWorkInput, UpdateWorkInput } from "@/lib/validations";

describe("legacy book action identity boundary", () => {
  it.each(["film", "perfume", "painting"])(
    "rejects creating %s before accessing the DB",
    async (kind) => {
      await expect(
        createWork({
          title: "Different medium",
          authorIds: [{ authorId: "11111111-1111-4111-8111-111111111111" }],
          kind,
        } as unknown as CreateWorkInput),
      ).rejects.toBeInstanceOf(ZodError);
      expect(databaseAccess).not.toHaveBeenCalled();
    },
  );

  it.each(["book", "film", "perfume", "painting"])(
    "rejects updating kind to %s before accessing the DB",
    async (kind) => {
      await expect(
        updateWork("11111111-1111-4111-8111-111111111111", {
          kind,
        } as unknown as UpdateWorkInput),
      ).rejects.toBeInstanceOf(ZodError);
      expect(databaseAccess).not.toHaveBeenCalled();
    },
  );
});
