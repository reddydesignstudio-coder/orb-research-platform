// data-quality Edge Function (TASK 014). All logic lives in the tested handler;
// this file only connects it to the Deno runtime and its environment.
import { createDataQualityHandler } from '../_shared/quality/handler.js';

Deno.serve(createDataQualityHandler({ env: (name: string) => Deno.env.get(name) }));
