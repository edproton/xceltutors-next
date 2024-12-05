import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { BookingStatus, fakeDatabase, BookingType, Booking } from "@/lib/mock";
import {
  createOrRegenerateStripeSessionForBooking,
  createStripeRefund,
} from "@/lib/stripe";

// Zod schema for booking validation
const createBookingSchema = z.object({
  startTime: z
    .string()
    .datetime({ message: "Invalid startTime. Must be ISO 8601 format." }),
  username: z.string().min(1, { message: "Username is required." }),
  hostUsername: z.string().min(1, { message: "Host username is required." }),
});

const recheduleBookingSchema = z.object({
  startTime: z
    .string()
    .datetime({ message: "Invalid startTime. Must be ISO 8601 format." }),
});

// Booking route
export const bookingRoute = new Hono()
  .post("/", zValidator("json", createBookingSchema), async (c) => {
    try {
      // Validated data
      const { startTime, username, hostUsername } = c.req.valid("json");

      if (new Date(startTime) < new Date()) {
        return c.json(
          {
            error: "Cannot book a meeting in the past.",
            code: "INVALID_START_TIME",
          },
          400
        );
      }

      // Can only mark one month in advance
      const oneMonthFromNow = new Date();
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
      if (new Date(startTime) > oneMonthFromNow) {
        return c.json(
          {
            error: "Cannot book a meeting more than one month in advance.",
            code: "INVALID_START_TIME",
          },
          400
        );
      }

      const validFreeMeetingStatuses = [
        BookingStatus.AWAITING_TUTOR_CONFIRMATION,
        BookingStatus.AWAITING_STUDENT_CONFIRMATION,
        BookingStatus.SCHEDULED,
      ];

      // Check if the user has already had a free meeting
      const alreadyHadFreeMeeting = fakeDatabase.some(
        (booking) =>
          booking.hostUsername === hostUsername &&
          booking.participantsUsernames.includes(username) &&
          booking.type === BookingType.FREE_MEETING &&
          validFreeMeetingStatuses.includes(booking.status)
      );

      // Determine the type of booking
      const type = alreadyHadFreeMeeting
        ? BookingType.LESSON
        : BookingType.FREE_MEETING;

      // Calculate endTime based on booking type
      const endTime = new Date(startTime);

      if (type === BookingType.FREE_MEETING) {
        endTime.setMinutes(endTime.getMinutes() + 15);
      } else if (type === BookingType.LESSON) {
        endTime.setMinutes(endTime.getMinutes() + 60);
      }

      // Check for host availability conflicts
      const isHostBusy = fakeDatabase.some(
        (booking) =>
          booking.hostUsername === hostUsername &&
          new Date(booking.startTime) < endTime &&
          new Date(booking.endTime) > new Date(startTime) &&
          validFreeMeetingStatuses.includes(booking.status)
      );

      if (isHostBusy) {
        return c.json(
          {
            error: "One booking already exists at this time.",
            code: "AVAILABILITY_CONFLICT",
          },
          400
        );
      }

      // Create the new booking
      const newBooking: Booking = {
        id: fakeDatabase.length + 1,
        startTime,
        endTime: endTime.toISOString(),
        hostUsername,
        participantsUsernames: [username],
        type,
        status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      };

      // Log and add the new booking to the database
      console.log(
        `Booking created: ${username} with ${hostUsername} at ${startTime} for type ${type}`
      );
      fakeDatabase.push(newBooking);

      return c.json(
        {
          message: "Booking created",
          booking: newBooking,
        },
        201
      );
    } catch (error) {
      console.error("Error creating booking:", error);
      return c.json(
        {
          error: "An unexpected error occurred.",
          code: "INTERNAL_SERVER_ERROR",
        },
        500
      );
    }
  })
  .get("/", (c) => {
    return c.json(
      {
        bookings: fakeDatabase,
      },
      200
    );
  })
  .patch(
    "/:id/reschedule",
    zValidator("json", recheduleBookingSchema),
    async (c) => {
      try {
        // Extract data
        const id = c.req.param("id");
        const { startTime } = c.req.valid("json");
        const username = c.req.header("x-username"); // Assuming username is passed in the header

        if (!username) {
          return c.json(
            {
              error: "Username is required in the header.",
              code: "MISSING_USERNAME",
            },
            400
          );
        }

        // Find the booking
        const bookingIndex = fakeDatabase.findIndex(
          (booking) => booking.id === parseInt(id, 10)
        );

        if (bookingIndex === -1) {
          return c.json(
            { error: "Booking not found.", code: "BOOKING_NOT_FOUND" },
            404
          );
        }

        const booking = fakeDatabase[bookingIndex];

        // Validate the user's role (tutor or student)
        const isTutor = booking.hostUsername === username;
        if (
          isTutor &&
          booking.status !== BookingStatus.AWAITING_TUTOR_CONFIRMATION
        ) {
          return c.json(
            {
              error: `The booking status is ${booking.status}. Only bookings ${BookingStatus.AWAITING_TUTOR_CONFIRMATION} can be rescheduled by the tutor.`,
              code: "UNAUTHORIZED",
            },
            403
          );
        }

        const isStudent = booking.participantsUsernames.includes(username);
        if (
          isStudent &&
          booking.status !== BookingStatus.AWAITING_STUDENT_CONFIRMATION
        ) {
          return c.json(
            {
              error: `The booking status is ${booking.status}. Only bookings ${BookingStatus.AWAITING_STUDENT_CONFIRMATION} can be rescheduled by the student.`,
              code: "UNAUTHORIZED",
            },
            403
          );
        }

        if (!isTutor && !isStudent) {
          return c.json(
            {
              error: "User not authorized to reschedule this booking.",
              code: "UNAUTHORIZED",
            },
            403
          );
        }

        if (
          new Date(startTime).getTime() ===
          new Date(booking.startTime).getTime()
        ) {
          return c.json(
            {
              error:
                "New start time is the same as the current start time. Please choose a different time.",
              code: "SAME_START_TIME",
            },
            400
          );
        }

        if (new Date(booking.startTime) < new Date()) {
          return c.json(
            {
              error: "Cannot reschedule a booking that has already started.",
              code: "INVALID_START_TIME",
            },
            400
          );
        }

        if (new Date(startTime) < new Date()) {
          return c.json(
            {
              error: "Cannot reschedule a booking to a past time.",
              code: "INVALID_START_TIME",
            },
            400
          );
        }

        // Calculate new end time
        const newStartTime = new Date(startTime);
        const newEndTime = new Date(newStartTime);

        if (booking.type === BookingType.FREE_MEETING) {
          newEndTime.setMinutes(newEndTime.getMinutes() + 15);
        } else if (booking.type === BookingType.LESSON) {
          newEndTime.setMinutes(newEndTime.getMinutes() + 60);
        }

        // Check for conflicts
        const isConflict = fakeDatabase.some(
          (b, idx) =>
            idx !== bookingIndex &&
            b.hostUsername === booking.hostUsername &&
            new Date(b.startTime) < newEndTime &&
            new Date(b.endTime) > newStartTime
        );

        if (isConflict) {
          return c.json(
            {
              error: "Another booking already exists at this time.",
              code: "AVAILABILITY_CONFLICT",
            },
            400
          );
        }

        // Update the booking details
        booking.startTime = newStartTime.toISOString();
        booking.endTime = newEndTime.toISOString();

        // Update booking status based on the user role
        booking.status = isTutor
          ? BookingStatus.AWAITING_STUDENT_CONFIRMATION
          : BookingStatus.AWAITING_TUTOR_CONFIRMATION;

        return c.json(
          {
            message: "Booking rescheduled successfully.",
            booking,
          },
          200
        );
      } catch (error) {
        console.error("Error rescheduling booking:", error);
        return c.json(
          {
            error: "An unexpected error occurred.",
            code: "INTERNAL_SERVER_ERROR",
          },
          500
        );
      }
    }
  )
  .patch("/:id/cancel", async (c) => {
    try {
      // Extract data
      const id = c.req.param("id");
      const username = c.req.header("x-username");
      if (!username) {
        return c.json(
          {
            error: "Username is required in the header.",
            code: "MISSING_USERNAME",
          },
          400
        );
      }
      // Find the booking
      const bookingIndex = fakeDatabase.findIndex(
        (booking) => booking.id === parseInt(id, 10)
      );

      if (bookingIndex === -1) {
        return c.json(
          { error: "Booking not found.", code: "BOOKING_NOT_FOUND" },
          404
        );
      }

      const booking = fakeDatabase[bookingIndex];

      // Validate the user's role (tutor or student)
      const isTutor = booking.hostUsername === username;
      const isStudent = booking.participantsUsernames.includes(username);

      if (!isTutor && !isStudent) {
        return c.json(
          {
            error: "User not authorized to cancel this booking.",
            code: "UNAUTHORIZED",
          },
          403
        );
      }

      // Allow cancellation only if the booking is not already completed or canceled
      const validBookingStatusesForCancelation = [
        BookingStatus.AWAITING_TUTOR_CONFIRMATION,
        BookingStatus.AWAITING_STUDENT_CONFIRMATION,
        BookingStatus.SCHEDULED,
        BookingStatus.AWAITING_PAYMENT,
        BookingStatus.PAYMENT_FAILED,
      ];

      if (!validBookingStatusesForCancelation.includes(booking.status)) {
        return c.json(
          {
            error: `The booking status is ${booking.status}. It cannot be canceled.`,
            code: "INVALID_STATUS",
          },
          400
        );
      }

      // Update booking status to canceled
      booking.status = BookingStatus.CANCELED;

      return c.json(
        {
          message: "Booking canceled successfully.",
          booking,
        },
        200
      );
    } catch (error) {
      console.error("Error canceling booking:", error);
      return c.json(
        {
          error: "An unexpected error occurred.",
          code: "INTERNAL_SERVER_ERROR",
        },
        500
      );
    }
  })
  .patch("/:id/cancel/refund", async (c) => {
    try {
      // Extract data
      const id = c.req.param("id");
      const username = c.req.header("x-username");
      if (!username) {
        return c.json(
          {
            error: "Username is required in the header.",
            code: "MISSING_USERNAME",
          },
          400
        );
      }

      // Find the booking
      const bookingIndex = fakeDatabase.findIndex(
        (booking) => booking.id === parseInt(id, 10)
      );

      if (bookingIndex === -1) {
        return c.json(
          { error: "Booking not found.", code: "BOOKING_NOT_FOUND" },
          404
        );
      }

      const booking = fakeDatabase[bookingIndex];

      // Validate booking status - only paid bookings can be refunded
      if (booking.status !== BookingStatus.SCHEDULED) {
        return c.json(
          {
            error: `The booking status is ${booking.status}. Only ${BookingStatus.SCHEDULED} bookings can be refunded.`,
            code: "INVALID_STATUS",
          },
          400
        );
      }

      // Process refund through Stripe
      if (booking.payment?.chargeId || booking.payment?.paymentIntentId) {
        await createStripeRefund(booking);
      }

      return c.json(
        {
          message: "Booking refunded in process.",
          booking,
        },
        200
      );
    } catch (error) {
      console.error("Error refunding booking:", error);
      return c.json(
        {
          error: "An unexpected error occurred.",
          code: "INTERNAL_SERVER_ERROR",
        },
        500
      );
    }
  })
  .patch("/:id/confirm", async (c) => {
    try {
      // Extract data
      const id = c.req.param("id");
      const username = c.req.header("x-username");
      if (!username) {
        return c.json(
          {
            error: "Username is required in the header.",
            code: "MISSING_USERNAME",
          },
          400
        );
      }

      // Find the booking
      const bookingIndex = fakeDatabase.findIndex(
        (booking) => booking.id === parseInt(id, 10)
      );

      if (bookingIndex === -1) {
        return c.json(
          { error: "Booking not found.", code: "BOOKING_NOT_FOUND" },
          404
        );
      }

      const booking = fakeDatabase[bookingIndex];

      // Validate the user's role (tutor or student)
      const isTutor = booking.hostUsername === username;
      const isStudent = booking.participantsUsernames.includes(username);

      if (!isTutor && !isStudent) {
        return c.json(
          {
            error: "User not authorized to confirm this booking.",
            code: "UNAUTHORIZED",
          },
          403
        );
      }

      const validBookingStatusesForConfirmation = [
        BookingStatus.AWAITING_TUTOR_CONFIRMATION,
        BookingStatus.AWAITING_STUDENT_CONFIRMATION,
      ];

      // Allow confirmation only for certain statuses
      if (!validBookingStatusesForConfirmation.includes(booking.status)) {
        return c.json(
          {
            error: `The booking status is ${booking.status}. It cannot be confirmed.`,
            code: "INVALID_STATUS",
          },
          400
        );
      }

      // Update booking status to scheduled
      booking.status =
        booking.type === BookingType.FREE_MEETING
          ? BookingStatus.SCHEDULED
          : BookingStatus.AWAITING_PAYMENT;

      // Trigger payment flow for lesson bookings
      if (booking.type === BookingType.LESSON) {
        const paymentData = await createOrRegenerateStripeSessionForBooking(
          booking,
          1000
        ); // Example amount: $10.00

        booking.payment = {
          sessionId: paymentData.sessionUrl, // Store the session URL in the booking
        };

        // Store the session URL in the booking
      }

      return c.json(
        {
          message: "Booking confirmed successfully.",
          booking,
        },
        200
      );
    } catch (error) {
      console.error("Error confirming booking:", error);
      return c.json(
        {
          error: "An unexpected error occurred.",
          code: "INTERNAL_SERVER_ERROR",
        },
        500
      );
    }
  });
