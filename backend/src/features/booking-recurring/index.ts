import { prisma, Transaction } from "@/lib/prisma";
import {
  RecurrencePattern,
  User,
  WeekDay,
  Role,
  BookingStatus,
  BookingType,
  RecurringTemplateStatus,
} from "@prisma/client";
import { BookingValidationError } from "../errors";
import { DateTime } from "luxon";
import { TimeSlotValidator } from "../helpers/time-slot-validator";
import {
  BookingDate,
  BookingDateGenerator,
} from "../helpers/booking-date-generator";
import { ConflictChecker, TimeSlotConflict } from "../helpers/conflict-checker";
import { RecurringTemplateValidator } from "../helpers/recurring-template-validator";

export type TimeSlot = {
  weekDay: WeekDay;
  startTime: string; // HH:mm in UTC
};

export interface CreateRecurringBookingsCommand {
  title: string;
  description?: string;
  hostId: number;
  recurrencePattern: RecurrencePattern;
  timeSlots: TimeSlot[];
  currentUser: User;
  overrides?: Array<{
    conflictTime: string;
    newStartTime: string;
  }>;
}

export interface RecurringBookingsResult {
  recurringTemplateId: number;
  conflicts?: TimeSlotConflict[];
}

export class CreateRecurringBookingsCommandHandler {
  private static readonly LESSON_DURATION_MINUTES =
    TimeSlotValidator.LESSON_DURATION_MINUTES;

  static async execute(
    command: CreateRecurringBookingsCommand
  ): Promise<RecurringBookingsResult> {
    await this.validateCommand(command);

    return await prisma.$transaction(async (tx) => {
      await this.validatePriorBooking(command, tx);
      await this.validateExistingRecurringBookings(command, tx);

      const startDate = DateTime.now().setZone("UTC").startOf("day");
      const bookingDates = BookingDateGenerator.generateBookingDates(
        command.timeSlots,
        startDate,
        command.recurrencePattern
      );

      const conflicts = await ConflictChecker.checkConflicts(
        bookingDates,
        command,
        tx
      );

      if (conflicts.length > 0 && !command.overrides?.length) {
        return { recurringTemplateId: -1, conflicts };
      }

      if (conflicts.length > 0 && command.overrides?.length) {
        return await this.handleConflictsWithOverrides(
          conflicts,
          command,
          bookingDates,
          tx
        );
      }

      const template = await this.createTemplateAndBookings(
        command,
        bookingDates,
        tx
      );

      return { recurringTemplateId: template.id };
    });
  }

  private static async validateCommand(
    command: CreateRecurringBookingsCommand
  ): Promise<void> {
    if (command.hostId === command.currentUser.id) {
      throw new BookingValidationError(
        "INVALID_INPUT",
        "Host cannot book lessons with themselves"
      );
    }

    if (command.currentUser.roles.includes(Role.TUTOR)) {
      throw new BookingValidationError(
        "INVALID_INPUT",
        "Tutors cannot create recurring lessons"
      );
    }

    if (command.timeSlots.length === 0) {
      throw new BookingValidationError(
        "INVALID_TIME_SLOTS",
        "At least one time slot must be provided"
      );
    }

    TimeSlotValidator.validateTimeSlots(command.timeSlots);
    await this.validateUserRoles(command);
  }

  private static async validateUserRoles(
    command: CreateRecurringBookingsCommand
  ): Promise<void> {
    const users = await prisma.user.findMany({
      where: {
        id: { in: [command.hostId, command.currentUser.id] },
      },
      select: {
        id: true,
        roles: true,
      },
    });

    const host = users.find((u) => u.id === command.hostId);
    const participant = users.find((u) => u.id === command.currentUser.id);

    if (!host?.roles.includes(Role.TUTOR)) {
      throw new BookingValidationError(
        "INVALID_HOST",
        "Host not found or is not a tutor"
      );
    }

    if (!participant?.roles.includes(Role.STUDENT)) {
      throw new BookingValidationError(
        "INVALID_PARTICIPANT",
        "Participant must be a student"
      );
    }
  }

  private static async validatePriorBooking(
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<void> {
    const priorBooking = await tx.booking.findFirst({
      where: {
        hostId: command.hostId,
        participants: { some: { id: command.currentUser.id } },
        status: { in: [BookingStatus.COMPLETED, BookingStatus.SCHEDULED] },
      },
      select: { id: true },
    });

    if (!priorBooking) {
      throw new BookingValidationError(
        "NO_PRIOR_BOOKING",
        "You must have at least one completed lesson with this tutor"
      );
    }
  }

  private static async createTemplateAndBookings(
    command: CreateRecurringBookingsCommand,
    bookingDates: BookingDate[],
    tx: Transaction
  ) {
    return await tx.recurringTemplate.create({
      data: {
        title: command.title,
        description: command.description,
        hostId: command.hostId,
        status: RecurringTemplateStatus.ACTIVE,
        recurrencePattern: command.recurrencePattern,
        durationMinutes: 60,
        timeSlots: {
          create: command.timeSlots.map((slot) => ({
            weekDay: slot.weekDay,
            startTime: DateTime.fromFormat(slot.startTime, "HH:mm", {
              zone: "UTC",
            }).toJSDate(),
          })),
        },
        bookings: {
          create: bookingDates.map(({ startTime, endTime }) => ({
            title: command.title,
            description: command.description,
            startTime: startTime.toJSDate(),
            endTime: endTime.toJSDate(),
            type: BookingType.LESSON,
            status: BookingStatus.AWAITING_STUDENT_CONFIRMATION,
            hostId: command.hostId,
            participants: {
              connect: [{ id: command.currentUser.id }],
            },
          })),
        },
      },
    });
  }

  private static async handleConflictsWithOverrides(
    conflicts: TimeSlotConflict[],
    command: CreateRecurringBookingsCommand,
    bookingDates: BookingDate[],
    tx: Transaction
  ): Promise<RecurringBookingsResult> {
    const providedOverrides = new Set(
      command.overrides!.map((o) => o.conflictTime)
    );
    const unhandledConflicts = conflicts.filter(
      (c) => !providedOverrides.has(c.conflictTime)
    );

    if (unhandledConflicts.length > 0) {
      return {
        recurringTemplateId: -1,
        conflicts: unhandledConflicts,
      };
    }

    // Apply overrides to the booking dates instead of trying to modify existing bookings
    const updatedBookingDates = bookingDates.map((date) => {
      const dateStr = this.formatToUTCString(date.startTime);
      const override = command.overrides?.find(
        (o) => o.conflictTime === dateStr
      );

      if (override) {
        const newStartTime = DateTime.fromISO(override.newStartTime);
        if (!TimeSlotValidator.isValidTimeSlot(newStartTime)) {
          throw new BookingValidationError(
            "INVALID_OVERRIDE_TIME",
            `Invalid override time format: ${override.newStartTime}`
          );
        }
        return {
          startTime: newStartTime,
          endTime: newStartTime.plus({
            minutes: TimeSlotValidator.LESSON_DURATION_MINUTES,
          }),
        };
      }
      return date;
    });

    // Validate the new times don't have conflicts
    const newConflicts = await ConflictChecker.checkConflicts(
      updatedBookingDates,
      command,
      tx
    );

    if (newConflicts.length > 0) {
      throw new BookingValidationError(
        "OVERRIDE_CONFLICT",
        `New time slot conflicts with existing booking`
      );
    }

    const template = await this.createTemplateAndBookings(
      command,
      updatedBookingDates,
      tx
    );

    return { recurringTemplateId: template.id };
  }

  private static formatToUTCString(dateTime: DateTime): string {
    return dateTime.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  }

  private static async validateExistingRecurringBookings(
    command: CreateRecurringBookingsCommand,
    tx: Transaction
  ): Promise<void> {
    await RecurringTemplateValidator.validateExistingTemplates(
      command.timeSlots,
      command.hostId,
      tx
    );
  }
}
