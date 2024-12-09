// src/features/bookings/helpers/time-slot-validator.ts

import { WeekDay } from "@prisma/client";
import { BookingValidationError } from "../errors";
import { TimeSlot } from "../booking-recurring";
import { DateTime } from "luxon";
import { TimeRange } from "../utils/booking-utils";

type ValidMinutes = 0 | 15 | 30 | 45;

interface ParsedTime {
  hours: number;
  minutes: ValidMinutes;
}

export class TimeSlotValidator {
  private static readonly VALID_END_TIMES = new Set([0, 15, 30, 45]);
  static readonly LESSON_DURATION_MINUTES = 60;

  static validateTimeSlots(timeSlots: TimeSlot[]): void {
    timeSlots.forEach((slot) => {
      const parsedTime = this.parseAndValidateTime(slot.startTime);
      if (!parsedTime) {
        throw new BookingValidationError(
          "INVALID_TIME_SLOT",
          "Time slots must be on 15-minute boundaries (00, 15, 30, 45)"
        );
      }
    });

    this.checkOverlappingSlots(timeSlots);
  }

  static parseAndValidateTime(timeString: string): ParsedTime | null {
    const [hoursStr, minutesStr] = timeString.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (
      isNaN(hours) ||
      isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      !this.VALID_END_TIMES.has(minutes)
    ) {
      return null;
    }

    this.validateLessonTimeSpan(hours, minutes);

    return { hours, minutes: minutes as ValidMinutes };
  }

  private static validateLessonTimeSpan(hours: number, minutes: number): void {
    const endHour =
      hours + Math.floor((minutes + this.LESSON_DURATION_MINUTES) / 60);
    if (endHour >= 24) {
      throw new BookingValidationError(
        "INVALID_TIME_SLOT",
        `Cannot schedule a ${this.LESSON_DURATION_MINUTES}-minute lesson that extends past midnight`
      );
    }
  }

  private static checkOverlappingSlots(timeSlots: TimeSlot[]): void {
    const slotsByDay = this.groupSlotsByDay(timeSlots);

    for (const [weekDay, times] of Array.from(slotsByDay.entries())) {
      this.validateDaySlots(weekDay, times);
    }
  }

  private static groupSlotsByDay(
    timeSlots: TimeSlot[]
  ): Map<WeekDay, ParsedTime[]> {
    const slotsByDay = new Map<WeekDay, ParsedTime[]>();

    timeSlots.forEach((slot) => {
      const parsed = this.parseAndValidateTime(slot.startTime)!;
      const existing = slotsByDay.get(slot.weekDay) || [];
      slotsByDay.set(slot.weekDay, [...existing, parsed]);
    });

    return slotsByDay;
  }

  private static validateDaySlots(weekDay: WeekDay, times: ParsedTime[]): void {
    const sortedTimes = times.sort((a, b) => {
      return a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes);
    });

    for (let i = 0; i < sortedTimes.length - 1; i++) {
      this.checkConsecutiveSlots(weekDay, sortedTimes[i], sortedTimes[i + 1]);
    }
  }

  private static checkConsecutiveSlots(
    weekDay: WeekDay,
    current: ParsedTime,
    next: ParsedTime
  ): void {
    const currentSlotStart = current.hours * 60 + current.minutes;
    const currentSlotEnd = currentSlotStart + this.LESSON_DURATION_MINUTES;
    const nextSlotStart = next.hours * 60 + next.minutes;

    if (currentSlotEnd > nextSlotStart) {
      throw new BookingValidationError(
        "OVERLAPPING_TIME_SLOTS",
        `Overlapping time slots found on ${weekDay}. A slot starting at ${this.formatTime(current)} overlaps with the next slot at ${this.formatTime(next)}`
      );
    }
  }

  private static formatTime(time: ParsedTime): string {
    return `${time.hours.toString().padStart(2, "0")}:${time.minutes.toString().padStart(2, "0")}`;
  }

  static getTimeRange(time: ParsedTime): TimeRange {
    const startMinutes = time.hours * 60 + time.minutes;
    return {
      start: startMinutes,
      end: startMinutes + this.LESSON_DURATION_MINUTES,
    };
  }

  static getTimeRangeFromHoursMinutes(hours: number, minutes: number) {
    const start = hours * 60 + minutes;
    return {
      start,
      end: start + this.LESSON_DURATION_MINUTES,
    };
  }

  static hasOverlap(
    range1: { start: number; end: number },
    range2: { start: number; end: number }
  ): boolean {
    return (
      (range1.start >= range2.start && range1.start < range2.end) ||
      (range1.end > range2.start && range1.end <= range2.end) ||
      (range1.start <= range2.start && range1.end >= range2.end)
    );
  }

  static isValidTimeSlot(dateTime: DateTime): boolean {
    return this.VALID_END_TIMES.has(dateTime.minute);
  }
}
