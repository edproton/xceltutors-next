import { env } from "@/config";
import { stripe } from "@/lib/stripe";
import { BookingValidationError } from "@/features/errors";
import { HandlePaymentIntentCommandHandler } from "./event-commands/payment-intent.command";
import { HandleRefundCommandHandler } from "./event-commands/refund.command";
import { HandleChargeRefundCommandHandler } from "./event-commands/charge-refund.command";
import { BookingStatus } from "@prisma/client";

export enum WebhookEventType {
  PAYMENT_INTENT_SUCCEEDED = "payment_intent.succeeded",
  PAYMENT_INTENT_FAILED = "payment_intent.payment_failed",
  CHARGE_REFUNDED = "charge.refunded",
  REFUND_CREATED = "refund.created",
  REFUND_FAILED = "refund.failed",
}

export interface HandleWebhookCommand {
  body: string;
  signature: string;
}

export class HandleWebhookCommandHandler {
  static async execute(command: HandleWebhookCommand): Promise<void> {
    if (!command.signature) {
      throw new BookingValidationError(
        "INVALID_SIGNATURE",
        "Missing stripe signature"
      );
    }

    const event = await stripe.webhooks.constructEventAsync(
      command.body,
      command.signature,
      env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case WebhookEventType.PAYMENT_INTENT_SUCCEEDED:
        await HandlePaymentIntentCommandHandler.execute({
          event: event.data.object,
          newStatus: BookingStatus.SCHEDULED,
        });
        break;

      case WebhookEventType.PAYMENT_INTENT_FAILED:
        await HandlePaymentIntentCommandHandler.execute({
          event: event.data.object,
          newStatus: BookingStatus.PAYMENT_FAILED,
        });
        break;

      case WebhookEventType.CHARGE_REFUNDED:
        await HandleChargeRefundCommandHandler.execute({
          event: event.data.object,
        });
        break;

      case WebhookEventType.REFUND_CREATED:
        await HandleRefundCommandHandler.execute({
          event: event.data.object,
          newStatus: BookingStatus.AWAITING_REFUND,
          expectedStatus: BookingStatus.AWAITING_REFUND,
        });
        break;

      case WebhookEventType.REFUND_FAILED:
        await HandleRefundCommandHandler.execute({
          event: event.data.object,
          newStatus: BookingStatus.REFUND_FAILED,
          expectedStatus: BookingStatus.AWAITING_REFUND,
        });
        break;
    }
  }
}
