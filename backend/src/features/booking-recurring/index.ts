import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  RecurrencePattern,
  User,
  Prisma,
} from "@prisma/client";
import { BookingValidationError } from "../errors";
import { DateTime } from "luxon";

type BookingWithParticipantsAndPayment = Prisma.BookingGetPayload<{
  include: { participants: true; payment: true; host: true };
}>;

export interface CreateRecurringBookingsCommand {
  parentBookingId: number;
  recurrencePattern: RecurrencePattern;
  recurrenceEnd: Date;
  currentUser: User;
}

export class CreateRecurringBookingsCommandHandler {
  private static readonly MAX_RECURRENCE_MONTHS = 1;

  static async execute(
    command: CreateRecurringBookingsCommand
  ): Promise<Booking[]> {
    const parentBooking = await prisma.booking.findUnique({
      where: { id: command.parentBookingId },
      include: {
        host: true,
        participants: true,
        payment: true,
      },
    });

    if (!parentBooking) {
      throw new BookingValidationError(
        "BOOKING_NOT_FOUND",
        "Parent booking not found"
      );
    }

    await this.validateCommand(command, parentBooking);

    const recurringBookings = await this.generateRecurringBookings(
      parentBooking,
      command.recurrencePattern,
      command.recurrenceEnd
    );

    return await this.saveRecurringBookings(parentBooking, recurringBookings);
  }

  private static async validateCommand(
    command: CreateRecurringBookingsCommand,
    parentBooking: BookingWithParticipantsAndPayment
  ): Promise<void> {
    // Convert dates to Luxon UTC
    const parentStart = DateTime.fromJSDate(parentBooking.startTime, {
      zone: "utc",
    });
    const recurrenceEnd = DateTime.fromJSDate(command.recurrenceEnd, {
      zone: "utc",
    });
    const maxEndDate = parentStart.plus({ months: this.MAX_RECURRENCE_MONTHS });

    // Validate user authorization
    if (parentBooking.hostId !== command.currentUser.id) {
      throw new BookingValidationError(
        "UNAUTHORIZED",
        "Only the host can create recurring bookings"
      );
    }

    // Validate recurrence pattern
    if (command.recurrencePattern === RecurrencePattern.NONE) {
      throw new BookingValidationError(
        "INVALID_RECURRENCE",
        "Recurrence pattern cannot be NONE"
      );
    }

    // Validate recurrence end date
    if (recurrenceEnd <= parentStart) {
      throw new BookingValidationError(
        "INVALID_RECURRENCE_END",
        "Recurrence end date must be after the parent booking start time"
      );
    }

    // Validate recurrence end date doesn't exceed 1 month
    if (recurrenceEnd > maxEndDate) {
      throw new BookingValidationError(
        "INVALID_RECURRENCE_END",
        "Recurring bookings can only be created up to 1 month in advance"
      );
    }

    // Validate parent booking has at least one participant
    if (parentBooking.participants.length === 0) {
      throw new BookingValidationError(
        "INVALID_PARTICIPANTS",
        "Parent booking must have at least one participant"
      );
    }
  }

  private static async generateRecurringBookings(
    parentBooking: BookingWithParticipantsAndPayment,
    recurrencePattern: RecurrencePattern,
    recurrenceEnd: Date
  ): Promise<Omit<Booking, "id" | "createdAt" | "updatedAt">[]> {
    const recurringBookings: Omit<Booking, "id" | "createdAt" | "updatedAt">[] =
      [];

    // Convert all dates to Luxon UTC
    let currentDate = DateTime.fromJSDate(parentBooking.startTime, {
      zone: "utc",
    });
    const endDate = DateTime.fromJSDate(recurrenceEnd, { zone: "utc" });
    const maxEndDate = currentDate.plus({ months: this.MAX_RECURRENCE_MONTHS });

    // Calculate duration in milliseconds
    const duration = DateTime.fromJSDate(parentBooking.endTime, { zone: "utc" })
      .diff(currentDate)
      .toMillis();

    // Use the earlier of recurrenceEnd and maxEndDate
    const effectiveEndDate = endDate > maxEndDate ? maxEndDate : endDate;

    // Get first occurrence
    currentDate = this.getNextDate(currentDate, recurrencePattern);

    while (currentDate <= effectiveEndDate) {
      const bookingEndTime = currentDate.plus({ milliseconds: duration });

      recurringBookings.push({
        title: parentBooking.title,
        description: parentBooking.description,
        startTime: currentDate.toJSDate(),
        endTime: bookingEndTime.toJSDate(),
        type: parentBooking.type,
        status: BookingStatus.AWAITING_STUDENT_CONFIRMATION,
        hostId: parentBooking.hostId,
        recurrence: recurrencePattern,
        recurrenceEnd: effectiveEndDate.toJSDate(),
        parentBookingId: parentBooking.id,
      });

      currentDate = this.getNextDate(currentDate, recurrencePattern);
    }

    return recurringBookings;
  }

  private static getNextDate(
    currentDate: DateTime,
    pattern: RecurrencePattern
  ): DateTime {
    switch (pattern) {
      case RecurrencePattern.DAILY:
        return currentDate.plus({ days: 1 });
      case RecurrencePattern.WEEKLY:
        return currentDate.plus({ weeks: 1 });
      case RecurrencePattern.BIWEEKLY:
        return currentDate.plus({ weeks: 2 });
      case RecurrencePattern.MONTHLY:
        return currentDate.plus({ months: 1 });
      case RecurrencePattern.CUSTOM:
        // For custom patterns, default to weekly
        // You might want to add custom logic here based on your requirements
        return currentDate.plus({ weeks: 1 });
      default:
        throw new BookingValidationError(
          "INVALID_RECURRENCE_PATTERN",
          "Unsupported recurrence pattern"
        );
    }
  }

  private static async saveRecurringBookings(
    parentBooking: BookingWithParticipantsAndPayment,
    recurringBookings: Omit<Booking, "id" | "createdAt" | "updatedAt">[]
  ): Promise<Booking[]> {
    // Update parent booking to include recurrence information
    await prisma.booking.update({
      where: { id: parentBooking.id },
      data: {
        recurrence: recurringBookings[0].recurrence,
        recurrenceEnd: recurringBookings[0].recurrenceEnd,
      },
    });

    // Create all recurring bookings in a transaction
    return await prisma.$transaction(
      recurringBookings.map((booking) =>
        prisma.booking.create({
          data: {
            ...booking,
            participants: {
              connect: parentBooking.participants.map((p) => ({ id: p.id })),
            },
          },
          include: {
            host: true,
            participants: true,
            payment: true,
          },
        })
      )
    );
  }
}
