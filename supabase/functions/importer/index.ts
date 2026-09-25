// importer Edge Function (TASK 008). All logic lives in the tested handler;
// this file only connects it to the Deno runtime and its environment.
import { createImporterHandler } from '../_shared/importer/handler.js';

Deno.serve(createImporterHandler({ env: (name: string) => Deno.env.get(name) }));
