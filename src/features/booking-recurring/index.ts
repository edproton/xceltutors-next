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
import { BookingUtils } from "../utils/booking-utils";

export type TimeSlot = {
  weekDay: WeekDay;
  startTime: string; // HH:mm in UTC
};

export interface Override {
  conflictTime: string;
  newStartTimeSlot?: string;
  cancel?: boolean;
}

export interface CreateRecurringBookingsCommand {
  title: string;
  description?: string;
  hostId: number;
  recurrencePattern: RecurrencePattern;
  timeSlots: TimeSlot[];
  currentUser: User;
  overrides?: Override[];
}
export interface RecurringBookingsResult {
  recurringTemplateId: number;
  conflicts?: TimeSlotConflict[];
}

export class CreateRecurringBookingsCommandHandler {
  static async execute(
    command: CreateRecurringBookingsCommand
  ): Promise<RecurringBookingsResult> {
    await this.validateCommand(command);

    return await prisma.$transaction(async (tx) => {
      // First check if there's a prior booking
      await this.validatePriorBooking(command, tx);

      // Then check for conflicts with existing recurring templates
      // This will throw if there's a conflict
      await RecurringTemplateValidator.validateExistingTemplates(
        command.timeSlots,
        command.hostId,
        tx
      );

      // Only if there are no recurring conflicts, proceed with booking generation
      const startDate = DateTime.now().setZone("UTC").startOf("day");
      const bookingDates = BookingDateGenerator.generateBookingDates(
        command.timeSlots,
        startDate,
        command.recurrencePattern
      );

      // Check for conflicts with individual bookings
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
            serviceId: 1,
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

    // Filter out cancelled bookings and update times for rescheduled ones
    const updatedBookingDates = bookingDates
      .filter((date) => {
        const dateStr = BookingUtils.formatToUTCString(date.startTime);
        const override = command.overrides?.find(
          (o) => o.conflictTime === dateStr
        );

        // Remove cancelled bookings
        if (override?.cancel) {
          return false;
        }

        return true;
      })
      .map((date) => {
        const dateStr = BookingUtils.formatToUTCString(date.startTime);
        const override = command.overrides?.find(
          (o) => o.conflictTime === dateStr
        );

        // Update rescheduled bookings
        if (override?.newStartTimeSlot) {
          const [hours, minutes] = override.newStartTimeSlot
            .split(":")
            .map(Number);
          const newStartTime = date.startTime.set({
            hour: hours,
            minute: minutes,
          });

          if (!TimeSlotValidator.isValidTimeSlot(newStartTime)) {
            throw new BookingValidationError(
              "INVALID_OVERRIDE_TIME",
              `Invalid override time format: ${override.newStartTimeSlot}`
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
}
