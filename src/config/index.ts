import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  FRONTEND_URL: z.string().url(),
  ORIGIN: z.string(),
  PORT: z.coerce
    .number()
    .optional()
    .default(() => {
      const originUrl = new URL(process.env.ORIGIN!);

      return originUrl.port ? parseInt(originUrl.port, 10) : 5000;
    }),
  DATABASE_URL: z.string().url(),
  PULSE_API_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_ACCESS_KEY_SECRET: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_DOMAIN: z.string().min(1),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
});

export const env = configSchema.parse(process.env);
