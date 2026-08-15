import { VALIDATION_MODES, CLOCK_MODES, REDIRECT_MODES } from "@paymob-simulator/contracts";
import { z } from "zod";

// Mounted configuration file schema (spec section 8.2).

export const integrationConfigSchema = z.object({
  id: z.number().int().positive(),
  iframeId: z.number().int().positive().optional(),
  name: z.string().min(1),
  paymentMethod: z.string().default("card"),
  sourceSubtype: z.string().default("Visa"),
  iframeCompletionMode: z
    .enum([
      "stay_in_checkout",
      "redirect_current_window",
      "redirect_top_window",
      "redirect_iframe",
      "post_message",
      "post_message_and_redirect",
      "close_embedded_checkout",
    ])
    .default("post_message_and_redirect"),
  notificationUrl: z.string().optional(),
  redirectionUrl: z.string().optional(),
});
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

export const configFileSchema = z.object({
  version: z.literal(1),
  server: z
    .object({
      publicUrl: z.string().default("http://localhost:8080"),
      port: z.number().int().positive().default(8080),
    })
    .default({ publicUrl: "http://localhost:8080", port: 8080 }),
  credentials: z
    .object({
      secretKey: z.string().default("sk_sim_local"),
      publicKey: z.string().default("pk_sim_local"),
      apiKey: z.string().default("api_sim_local"),
      hmacSecret: z.string().default("sim_hmac_secret"),
    })
    .default({
      secretKey: "sk_sim_local",
      publicKey: "pk_sim_local",
      apiKey: "api_sim_local",
      hmacSecret: "sim_hmac_secret",
    }),
  defaults: z
    .object({
      currency: z.string().default("EGP"),
      scenario: z.string().default("success-immediate"),
      notificationUrl: z.string().optional(),
      redirectionUrl: z.string().optional(),
      redirectMode: z.enum(REDIRECT_MODES).default("paymob_query_order"),
      validationMode: z.enum(VALIDATION_MODES).default("realistic"),
    })
    .default({
      currency: "EGP",
      scenario: "success-immediate",
      redirectMode: "paymob_query_order",
      validationMode: "realistic",
    }),
  integrations: z.array(integrationConfigSchema).default([
    {
      id: 1001,
      iframeId: 2001,
      name: "Local cards",
      paymentMethod: "card",
      sourceSubtype: "Visa",
      iframeCompletionMode: "post_message_and_redirect",
    },
  ]),
  delivery: z
    .object({
      requestTimeout: z.string().default("10s"),
      retryOnTransportError: z.boolean().default(true),
      retryOnStatuses: z.array(z.number().int()).default([408, 425, 429, 500, 502, 503, 504]),
      retryIntervals: z.array(z.string()).default(["5s", "30s", "2m"]),
      maxAttempts: z.number().int().positive().default(4),
    })
    .default({
      requestTimeout: "10s",
      retryOnTransportError: true,
      retryOnStatuses: [408, 425, 429, 500, 502, 503, 504],
      retryIntervals: ["5s", "30s", "2m"],
      maxAttempts: 4,
    }),
  browser: z
    .object({
      allowedFrameAncestors: z.array(z.string()).default([]),
      allowedRedirectOrigins: z.array(z.string()).default([]),
    })
    .default({ allowedFrameAncestors: [], allowedRedirectOrigins: [] }),
  security: z
    .object({
      allowedWebhookHosts: z.array(z.string()).default(["backend", "host.docker.internal", "localhost", "127.0.0.1"]),
      allowPrivateNetworks: z.boolean().default(true),
      adminToken: z.string().nullable().default(null),
    })
    .default({
      allowedWebhookHosts: ["backend", "host.docker.internal", "localhost", "127.0.0.1"],
      allowPrivateNetworks: true,
      adminToken: null,
    }),
  clock: z
    .object({
      mode: z.enum(CLOCK_MODES).default("real"),
      manualStart: z.string().optional(),
    })
    .default({ mode: "real" }),
  features: z
    .object({
      enableLegacy: z.boolean().default(false),
      enablePixelShim: z.boolean().default(true),
      acceptPaymobSandboxCards: z.boolean().default(false),
    })
    .default({ enableLegacy: false, enablePixelShim: true, acceptPaymobSandboxCards: false }),
});
export type ConfigFile = z.infer<typeof configFileSchema>;

export const DEFAULT_CONFIG: ConfigFile = configFileSchema.parse({ version: 1 });
