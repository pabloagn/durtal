import { z } from "zod";

/** md5 of a record's stored state, read with it and returned on save. */
export const fingerprintSchema = z.string().regex(/^[a-f0-9]{32}$/);
