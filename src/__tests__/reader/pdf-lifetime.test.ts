import { describe, expect, it } from "vitest";
import { forPdfOwner } from "@/lib/reader/engines/foliate/pdf-lifetime";

describe("PDF consumer delivery ownership", () => {
  it("aborts one waiter without rejecting a surviving waiter on the same producer", async () => {
    let resolve!: (value: number) => void;
    const producer = new Promise<number>((yes) => {
      resolve = yes;
    });
    const a = new AbortController(),
      b = new AbortController();
    const first = forPdfOwner(producer, a.signal);
    const second = forPdfOwner(producer, b.signal);
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    a.abort();
    await rejected;
    resolve(42);
    expect(await second).toBe(42);
  });

  it("rejects delivery even when abort follows an already-resolved producer", async () => {
    const owner = new AbortController();
    const result = forPdfOwner(Promise.resolve(42), owner.signal);
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    owner.abort();
    await rejected;
  });

  it("observes producer rejection for an owner that was already aborted", async () => {
    const owner = new AbortController();
    owner.abort();
    await expect(
      forPdfOwner(Promise.reject(new Error("producer")), owner.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("delivers producer failures to active owners", async () => {
    await expect(
      forPdfOwner(
        Promise.reject(new Error("producer")),
        new AbortController().signal,
      ),
    ).rejects.toThrow("producer");
  });
});
