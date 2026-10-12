import { config } from "zod/v4";

// Strict reader CSP forbids runtime code generation. Configure before hydration
// so constructing client schemas skips Zod's optional eval capability probe.
config({ jitless: true });
