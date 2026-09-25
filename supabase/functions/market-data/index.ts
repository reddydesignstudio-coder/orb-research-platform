// market-data Edge Function (TASK 007). All logic lives in the tested handler;
// this file only connects it to the Deno runtime and its environment.
import { createMarketDataHandler } from '../_shared/market-data/handler.js';

Deno.serve(createMarketDataHandler({ env: (name: string) => Deno.env.get(name) }));
