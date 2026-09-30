import { z } from "zod";
import { ORGANIZATION_ROLES } from "@/lib/catalogue/organizations";

export const organizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    roles: z.array(z.enum(ORGANIZATION_ROLES)).min(1).max(10),
    parentId: z.uuid().nullable().optional(),
    country: z.string().trim().max(200).nullable().optional(),
    countryId: z.uuid().nullable().optional(),
    website: z
      .url({ protocol: /^https?$/ })
      .nullable()
      .optional(),
    description: z.string().max(10000).nullable().optional(),
    notes: z.string().max(10000).nullable().optional(),
    isFavourite: z.boolean().optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  })
  .superRefine((org, ctx) => {
    if (org.roles.includes("publisher") && org.roles.includes("imprint"))
      ctx.addIssue({
        code: "custom",
        path: ["roles"],
        message: "Choose publisher or imprint for the book profile",
      });
    if (org.roles.includes("imprint") !== !!org.parentId)
      ctx.addIssue({
        code: "custom",
        path: ["parentId"],
        message: "Only an imprint requires a parent publisher",
      });
  });
export type OrganizationInput = z.input<typeof organizationSchema>;
