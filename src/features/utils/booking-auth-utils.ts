import { User, BookingStatus, Role } from "@prisma/client";
import { BookingValidationError } from "../errors";

export interface BookingAuthInfo {
  hostId: number;
  participants: { id: number }[];
  status: BookingStatus;
}

export class BookingAuthUtils {
  static async validateUserAuthorization(
    currentUser: User,
    booking: BookingAuthInfo
  ): Promise<void> {
    const isHost = booking.hostId === currentUser.id;
    const isParticipant = booking.participants.some(
      (p) => p.id === currentUser.id
    );

    if (!isHost && !isParticipant) {
      throw new BookingValidationError(
        "UNAUTHORIZED",
        "User not authorized for this booking operation"
      );
    }
  }

  static validateStatusForOperation(
    status: BookingStatus,
    validStatuses: BookingStatus[]
  ): void {
    if (!validStatuses.includes(status)) {
      throw new BookingValidationError(
        "INVALID_STATUS",
        `The booking status is ${status}. Operation not allowed.`
      );
    }
  }

  static validateUserRole(
    user: User,
    requiredRoles: Role[],
    operation: string
  ): void {
    const hasRequiredRole = requiredRoles.some((role) =>
      user.roles.includes(role)
    );

    if (!hasRequiredRole) {
      throw new BookingValidationError(
        "UNAUTHORIZED_ROLE",
        `User does not have the required role for ${operation}`
      );
    }
  }

  static validateTargetUser(
    currentUser: User,
    targetUserId: number,
    operation: string
  ): void {
    if (targetUserId === currentUser.id) {
      throw new BookingValidationError(
        "INVALID_TARGET_USER",
        `Cannot ${operation} with yourself`
      );
    }
  }

  static validateTutorStudentCombination(
    hostUser: User,
    participantUser: User
  ): void {
    const isTutorBookingTutor =
      hostUser.roles.includes(Role.TUTOR) &&
      participantUser.roles.includes(Role.TUTOR);

    if (isTutorBookingTutor) {
      throw new BookingValidationError(
        "INVALID_BOOKING_COMBINATION",
        "Tutors cannot book sessions with other tutors"
      );
    }
  }

  static canManageBooking(
    currentUser: User,
    booking: BookingAuthInfo
  ): boolean {
    return (
      currentUser.roles.includes(Role.ADMIN) ||
      booking.hostId === currentUser.id ||
      booking.participants.some((p) => p.id === currentUser.id)
    );
  }

  static async validateBookingAccessOrThrow(
    currentUser: User,
    booking: BookingAuthInfo,
    operation: string
  ): Promise<void> {
    if (!this.canManageBooking(currentUser, booking)) {
      throw new BookingValidationError(
        "UNAUTHORIZED",
        `User not authorized to ${operation} this booking`
      );
    }
  }

  static validatePaymentStatus(
    status: BookingStatus,
    paymentRequired: boolean
  ): void {
    const paymentStatuses: BookingStatus[] = [
      BookingStatus.AWAITING_PAYMENT,
      BookingStatus.PAYMENT_FAILED,
      BookingStatus.SCHEDULED,
    ];

    if (paymentRequired && !paymentStatuses.includes(status)) {
      throw new BookingValidationError(
        "INVALID_PAYMENT_STATUS",
        "Invalid payment status for this operation"
      );
    }
  }
}
