import { z } from 'zod';

export type ConfigSchemaType = z.infer<typeof ConfigSchema>;

export const ConfigSchema = z.object({
  server: z.object({
    encryptionKey: z
      .string()
      .regex(
        /^[0-9A-Fa-f]{64}$/g,
        'Encryption key needs to be a 64 character hex string',
      ),
    fallbackRedirectUrl: z.string().optional(),
    domains: z.array(z.string()),
    cookies: z.object({
      domain: z.string(),
    }),

    jwt: z.object({
      accessSecret: z.string(),
      refreshSecret: z.string(),
    }),

    boltz: z.object({
      enableWebsocket: z.boolean(),
      network: z.string().optional(),
    }),
    recoveryPageUrl: z.string(),
  }),

  redis: z.object({
    host: z.string(),
    port: z.number(),
    cacheTTL: z.number(),
  }),

  urls: z.object({
    boltz: z.string(),
    covclaim: z.string(),
    esplora: z.object({
      bitcoin: z.string(),
      liquid: z.string(),
      waterfall: z.string(),
    }),
  }),

  fiat: z
    .object({
      coingecko: z
        .object({
          url: z.string(),
          apikey: z.string(),
        })
        .optional(),
    })
    .optional(),

  sideshift: z
    .object({
      url: z.string(),
      secret: z.string(),
      affiliateId: z.string(),
    })
    .optional(),

  amboss: z
    .object({
      url: z.string(),
      secret: z.string(),
    })
    .optional(),

  mailgun: z
    .object({
      apiKey: z.string(),
      domain: z.string(),
    })
    .optional(),

  webauthn: z.object({
    name: z.string(),
    id: z.string(),
    origin: z.string(),
  }),
});
