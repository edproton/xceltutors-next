import { describe, test, expect, beforeEach, mock } from "bun:test";
import { BookingStatus, BookingType, Booking } from "@/lib/mock";
import { IBookingRepository } from "@/repositories/bookingRepository";
import { BookingService } from "@/services/bookingService";
import { StripeService } from "@/services/stripeService";

describe("BookingService", () => {
  let bookingService: BookingService;
  let mockBookingRepository: IBookingRepository;
  let mockStripeService: Partial<StripeService>;

  beforeEach(() => {
    mockBookingRepository = {
      getAllBookings: mock(() => Promise.resolve([] as Booking[])),
      getBookingById: mock(() =>
        Promise.resolve(undefined as Booking | undefined)
      ),
      saveBooking: mock((booking: Partial<Booking>) =>
        Promise.resolve({ ...booking, id: 1 } as Booking)
      ),
      updateBookingStatus: mock((id: number, status: BookingStatus) =>
        Promise.resolve({ id, status } as Booking)
      ),
      hasAlreadyHadFreeMeeting: mock(() => Promise.resolve(false)),
      checkBookingConflict: mock(() => Promise.resolve(false)),
    };

    mockStripeService = {
      createStripeRefund: mock(() => Promise.resolve()),
      cancelStripePaymentIntent: mock(() => Promise.resolve()),
      createOrRegenerateStripeSessionForBooking: mock(() =>
        Promise.resolve({
          sessionId: "sess_123",
          sessionUrl: "https://stripe.com/pay/sess_123",
        })
      ),
    };

    bookingService = new BookingService(
      mockBookingRepository,
      mockStripeService as StripeService
    );
  });

  describe("createBooking", () => {
    test("creates a free meeting for first-time booking", async () => {
      const startTime = new Date();
      startTime.setDate(startTime.getDate() + 1);
      const username = "student";
      const hostUsername = "tutor";

      mockBookingRepository.hasAlreadyHadFreeMeeting = mock(() =>
        Promise.resolve(false)
      );
      mockBookingRepository.saveBooking = mock(() =>
        Promise.resolve({
          id: 1,
          startTime: startTime.toISOString(),
          endTime: new Date(startTime.getTime() + 15 * 60000).toISOString(),
          hostUsername,
          participantsUsernames: [username],
          type: BookingType.FREE_MEETING,
          status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
        })
      );

      const result = await bookingService.createBooking(
        startTime.toISOString(),
        username,
        hostUsername
      );

      expect(result.type).toBe(BookingType.FREE_MEETING);
      expect(result.status).toBe(BookingStatus.AWAITING_TUTOR_CONFIRMATION);
      expect(result.participantsUsernames).toContain(username);
    });

    test("creates a lesson for returning student", async () => {
      const startTime = new Date();
      startTime.setDate(startTime.getDate() + 1);
      const username = "student";
      const hostUsername = "tutor";

      mockBookingRepository.hasAlreadyHadFreeMeeting = mock(() =>
        Promise.resolve(true)
      );
      mockBookingRepository.saveBooking = mock(() =>
        Promise.resolve({
          id: 1,
          startTime: startTime.toISOString(),
          endTime: new Date(startTime.getTime() + 60 * 60000).toISOString(),
          hostUsername,
          participantsUsernames: [username],
          type: BookingType.LESSON,
          status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
        })
      );

      const result = await bookingService.createBooking(
        startTime.toISOString(),
        username,
        hostUsername
      );

      expect(result.type).toBe(BookingType.LESSON);
      expect(result.status).toBe(BookingStatus.AWAITING_TUTOR_CONFIRMATION);
    });

    test("throws error for past booking time", async () => {
      const pastTime = new Date();
      pastTime.setDate(pastTime.getDate() - 1);

      await expect(
        bookingService.createBooking(pastTime.toISOString(), "student", "tutor")
      ).rejects.toThrow("Cannot book a meeting in the past.");
    });
  });

  describe("rescheduleBooking", () => {
    test("allows tutor to reschedule awaiting confirmation booking", async () => {
      const booking: Booking = {
        id: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        hostUsername: "tutor",
        participantsUsernames: ["student"],
        type: BookingType.LESSON,
        status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      };

      mockBookingRepository.getBookingById = mock(() =>
        Promise.resolve(booking)
      );
      mockBookingRepository.saveBooking = mock((updatedBooking) =>
        Promise.resolve(updatedBooking as Booking)
      );

      const newStartTime = new Date();
      newStartTime.setDate(newStartTime.getDate() + 1);

      const result = await bookingService.rescheduleBooking(
        1,
        newStartTime.toISOString(),
        "tutor"
      );

      expect(result.status).toBe(BookingStatus.AWAITING_STUDENT_CONFIRMATION);
      expect(result.startTime).toBe(newStartTime.toISOString());
    });
  });

  describe("cancelBooking", () => {
    test("successfully cancels a scheduled booking", async () => {
      const booking: Booking = {
        id: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        hostUsername: "tutor",
        participantsUsernames: ["student"],
        type: BookingType.LESSON,
        status: BookingStatus.SCHEDULED,
        payment: {
          sessionId: "sess_123",
          paymentIntentId: "pi_123",
          sessionUrl: "https://stripe.com/pay/sess_123",
        },
      };

      mockBookingRepository.getBookingById = mock(() =>
        Promise.resolve(booking)
      );
      mockBookingRepository.updateBookingStatus = mock(() =>
        Promise.resolve({ ...booking, status: BookingStatus.CANCELED })
      );

      const result = await bookingService.cancelBooking(1, "tutor");

      expect(result.booking?.status).toBe(BookingStatus.CANCELED);
      expect(mockStripeService.cancelStripePaymentIntent).toHaveBeenCalled();
    });
  });

  describe("confirmBooking", () => {
    test("sets status to SCHEDULED for free meeting", async () => {
      const booking: Booking = {
        id: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        hostUsername: "tutor",
        participantsUsernames: ["student"],
        type: BookingType.FREE_MEETING,
        status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      };

      mockBookingRepository.getBookingById = mock(() =>
        Promise.resolve(booking)
      );
      mockBookingRepository.updateBookingStatus = mock(() =>
        Promise.resolve({ ...booking, status: BookingStatus.SCHEDULED })
      );

      const result = await bookingService.confirmBooking("1", "tutor");

      expect(result.booking?.status).toBe(BookingStatus.SCHEDULED);
    });

    test("sets status to AWAITING_PAYMENT for lesson", async () => {
      const booking: Booking = {
        id: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        hostUsername: "tutor",
        participantsUsernames: ["student"],
        type: BookingType.LESSON,
        status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      };

      mockBookingRepository.getBookingById = mock(() =>
        Promise.resolve(booking)
      );
      mockBookingRepository.updateBookingStatus = mock(() =>
        Promise.resolve({
          ...booking,
          status: BookingStatus.AWAITING_PAYMENT,
          payment: {
            sessionId: "sess_123",
            sessionUrl: "https://stripe.com/pay/sess_123",
          },
        })
      );

      const result = await bookingService.confirmBooking("1", "tutor");

      expect(result.booking?.status).toBe(BookingStatus.AWAITING_PAYMENT);
      expect(result.booking?.payment?.sessionId).toBe("sess_123");
      expect(result.booking?.payment?.sessionUrl).toBe(
        "https://stripe.com/pay/sess_123"
      );
    });
  });
});
