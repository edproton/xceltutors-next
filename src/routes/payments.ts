import { HandleWebhookCommandHandler } from "@/features/payments-webhooks";
import { Context, Hono } from "hono";

async function webhook(c: Context): Promise<Response> {
  try {
    await HandleWebhookCommandHandler.execute({
      body: await c.req.text(),
      signature: c.req.header("stripe-signature") || "",
    });

    return c.text("Webhook processed successfully", 200);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Internal server error";
    return c.text(errorMessage, 400);
  }
}

export const paymentRoute = new Hono().post("/webhook", webhook);
