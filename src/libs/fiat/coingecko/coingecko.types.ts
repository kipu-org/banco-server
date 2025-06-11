import { z } from 'zod';

export const ONE_HOUR_IN_SECONDS = 60 * 60;

export const simplePrice = z.object({
  bitcoin: z.object({
    usd: z.number(),
  }),
});

export const marketChart = z.object({
  prices: z.array(z.array(z.number())),
  // Coingecko has some null values in this array for older dates
  market_caps: z.array(z.array(z.number().nullable())),
  total_volumes: z.array(z.array(z.number())),
});
