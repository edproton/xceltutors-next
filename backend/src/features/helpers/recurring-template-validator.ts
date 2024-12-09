import { RecurringTemplateStatus } from "@prisma/client";
import { BookingValidationError } from "../errors";
import { TimeSlot } from "../booking-recurring";
import { TimeSlotValidator } from "./time-slot-validator";
import { Transaction } from "@/lib/prisma";
import { BookingUtils, TimeRange } from "../utils/booking-utils";

export class RecurringTemplateValidator {
  static async validateExistingTemplates(
    timeSlots: TimeSlot[],
    hostId: number,
    tx: Transaction
  ): Promise<void> {
    const existingTemplates = await tx.recurringTemplate.findMany({
      where: {
        hostId,
        status: RecurringTemplateStatus.ACTIVE,
      },
      include: {
        timeSlots: true,
      },
    });

    for (const newSlot of timeSlots) {
      const parsedTime = TimeSlotValidator.parseAndValidateTime(
        newSlot.startTime
      );
      if (!parsedTime) continue; // Already validated in TimeSlotValidator

      const newSlotRange = TimeSlotValidator.getTimeRange(parsedTime);

      for (const template of existingTemplates) {
        const conflictingSlot = this.findConflictingSlot(
          template.timeSlots,
          newSlot,
          newSlotRange
        );
        if (conflictingSlot) {
          throw new BookingValidationError(
            "EXISTING_RECURRING_CONFLICT",
            `Time slot ${newSlot.weekDay} ${newSlot.startTime} conflicts with existing recurring booking at ${this.formatConflictTime(conflictingSlot.startTime)} (Template ID: ${template.id})`
          );
        }
      }
    }
  }

  private static findConflictingSlot(
    existingSlots: Array<{ weekDay: string; startTime: Date }>,
    newSlot: TimeSlot,
    newSlotRange: TimeRange
  ) {
    return existingSlots.find((existingSlot) => {
      if (existingSlot.weekDay !== newSlot.weekDay) {
        return false;
      }

      const existingRange = BookingUtils.createTimeRange(
        existingSlot.startTime,
        TimeSlotValidator.LESSON_DURATION_MINUTES
      );

      return BookingUtils.hasTimeRangeOverlap(newSlotRange, existingRange);
    });
  }

  private static formatConflictTime(time: Date): string {
    return BookingUtils.formatTimeHHMM(
      time.getUTCHours(),
      time.getUTCMinutes()
    );
  }
}
