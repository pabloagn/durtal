import { z } from "zod/v4";
import { GOAL_METRICS } from "@/lib/reading/constants";

/* Reading goals (SLN-455): every goal action's input */

const year = z.number().int().min(1900, "Pick a year from 1900 to 2200").max(2200, "Pick a year from 1900 to 2200");

export const setReadingGoalSchema = z
  .object({
    year,
    metric: z.enum(GOAL_METRICS),
    target: z.number().int("A goal is a whole number").min(1, "A goal is 1 or more").max(100_000, "A goal is at most 100,000"),
    countRereads: z.boolean().default(true),
    excludedWorkTypeIds: z.array(z.uuid()).max(500).default([]),
  })
  .strict();

export const removeReadingGoalSchema = z.object({ year, metric: z.enum(GOAL_METRICS) }).strict();

export const goalYearSchema = year;
