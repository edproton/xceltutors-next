export enum BookingStatus {
  AWAITING_TUTOR_CONFIRMATION = "AWAITING_TUTOR_CONFIRMATION",
  AWAITING_STUDENT_CONFIRMATION = "AWAITING_STUDENT_CONFIRMATION",
  AWAITING_PAYMENT = "AWAITING_PAYMENT",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  SCHEDULED = "SCHEDULED",
  CANCELED = "CANCELED",
  COMPLETED = "COMPLETED",
  REFUNDED = "REFUNDED",
  AWAITING_REFUND = "AWAITING_REFUND",
  REFUND_FAILED = "REFUND_FAILED",
}

export enum BookingType {
  FREE_MEETING = "FREE_MEETING",
  LESSON = "LESSON",
}

export type Booking = {
  id: number;
  startTime: string;
  endTime: string;
  hostUsername: string;
  participantsUsernames: string[];
  type: BookingType;
  status: BookingStatus;
  payment?: {
    sessionId: string;
    sessionUrl?: string;
    paymentIntentId?: string;
    chargeId?: string;
    metadata?: Record<string, string>;
  };
};
