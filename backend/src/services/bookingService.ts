import { Booking, BookingStatus, BookingType } from "@/lib/mock";
import { IBookingRepository } from "@/repositories/bookingRepository";
import { StripeService } from "./stripeService";

interface PaymentInfo {
  paymentIntentId: string;
  chargeId: string | undefined;
  metadata?: Record<string, string>;
}

export class BookingService {
  private bookingRepository: IBookingRepository;
  private stripeService: StripeService;

  constructor(
    bookingRepository: IBookingRepository,
    stripeService: StripeService
  ) {
    this.bookingRepository = bookingRepository;
    this.stripeService = stripeService;
  }

  async createBooking(
    startTime: string,
    username: string,
    hostUsername: string
  ): Promise<Booking> {
    if (new Date(startTime) < new Date()) {
      throw new Error("Cannot book a meeting in the past.");
    }

    // Can only mark one month in advance
    const oneMonthFromNow = new Date();
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    if (new Date(startTime) > oneMonthFromNow) {
      throw new Error("Cannot book a meeting more than one month in advance.");
    }

    console.log(this.bookingRepository.getAllBookings);
    // Check if the user has already had a free meeting
    const alreadyHadFreeMeeting =
      await this.bookingRepository.hasAlreadyHadFreeMeeting(
        hostUsername,
        username
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

    const isHostBusy = await this.bookingRepository.checkBookingConflict(
      hostUsername,
      new Date(startTime),
      endTime
    );

    if (isHostBusy) {
      throw new Error("One booking already exists at this time.");
    }

    const newBooking = await this.bookingRepository.saveBooking({
      startTime,
      endTime: endTime.toISOString(),
      hostUsername,
      participantsUsernames: [username],
      type,
      status: BookingStatus.AWAITING_TUTOR_CONFIRMATION,
    });

    return newBooking;
  }

  async getAllBookings(): Promise<Booking[]> {
    return this.bookingRepository.getAllBookings();
  }

  async getBooking(bookingId: number): Promise<Booking> {
    const booking = await this.bookingRepository.getBookingById(bookingId);
    if (!booking) {
      throw new Error(`Booking not found with ID: ${bookingId}`);
    }

    return booking;
  }

  async updateBookingStatus(
    bookingId: number,
    newStatus: BookingStatus,
    paymentInfo?: PaymentInfo
  ): Promise<Booking> {
    const booking = await this.getBooking(bookingId);
    booking.status = newStatus;

    if (booking.payment && paymentInfo) {
      booking.payment = {
        ...booking.payment,
        ...paymentInfo,
      };
    }

    return await this.bookingRepository.saveBooking(booking);
  }

  // Reschedule a booking
  async rescheduleBooking(
    id: number,
    startTime: string,
    username: string
  ): Promise<Booking> {
    const booking = await this.bookingRepository.getBookingById(id);

    if (!booking) {
      throw new Error("Booking not found");
    }

    // Validate the user role and booking status
    const isTutor = booking.hostUsername === username;
    const isStudent = booking.participantsUsernames.includes(username);

    if (
      isTutor &&
      booking.status !== BookingStatus.AWAITING_TUTOR_CONFIRMATION
    ) {
      throw new Error(
        `Only bookings in ${BookingStatus.AWAITING_TUTOR_CONFIRMATION} can be rescheduled by the tutor.`
      );
    }

    if (
      isStudent &&
      booking.status !== BookingStatus.AWAITING_STUDENT_CONFIRMATION
    ) {
      throw new Error(
        `Only bookings in ${BookingStatus.AWAITING_STUDENT_CONFIRMATION} can be rescheduled by the student.`
      );
    }

    if (!isTutor && !isStudent) {
      throw new Error("User not authorized to reschedule this booking.");
    }

    // Validate new start time
    const newStartTime = new Date(startTime);
    if (newStartTime <= new Date()) {
      throw new Error("Cannot reschedule to a past time.");
    }

    // Calculate the new end time based on booking type
    const newEndTime = new Date(newStartTime);
    if (booking.type === BookingType.FREE_MEETING) {
      newEndTime.setMinutes(newEndTime.getMinutes() + 15);
    } else if (booking.type === BookingType.LESSON) {
      newEndTime.setMinutes(newEndTime.getMinutes() + 60);
    }

    // Check for conflicts
    const isConflict = await this.bookingRepository.checkBookingConflict(
      booking.hostUsername,
      newStartTime,
      newEndTime
    );

    if (isConflict) {
      throw new Error("Another booking already exists at this time.");
    }

    // Update the booking details
    booking.startTime = newStartTime.toISOString();
    booking.endTime = newEndTime.toISOString();

    // Update the status based on who is rescheduling
    booking.status = isTutor
      ? BookingStatus.AWAITING_STUDENT_CONFIRMATION
      : BookingStatus.AWAITING_TUTOR_CONFIRMATION;

    return this.bookingRepository.saveBooking(booking);
  }

  // Cancel a booking
  async cancelBooking(id: number, username: string) {
    const booking = await this.bookingRepository.getBookingById(id);

    if (!booking) {
      return { error: "Booking not found.", code: "BOOKING_NOT_FOUND" };
    }

    // Validate user authorization
    const isTutor = booking.hostUsername === username;
    const isStudent = booking.participantsUsernames.includes(username);

    if (!isTutor && !isStudent) {
      return {
        error: "User not authorized to cancel this booking.",
        code: "UNAUTHORIZED",
      };
    }

    // Check valid booking status for cancellation
    const validStatusesForCancellation = [
      BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      BookingStatus.AWAITING_STUDENT_CONFIRMATION,
      BookingStatus.SCHEDULED,
      BookingStatus.AWAITING_PAYMENT,
      BookingStatus.PAYMENT_FAILED,
    ];

    if (!validStatusesForCancellation.includes(booking.status)) {
      return {
        error: `The booking status is ${booking.status}. It cannot be canceled.`,
        code: "INVALID_STATUS",
      };
    }

    if (!booking.payment) {
      return {
        error: "Booking has no payment information.",
        code: "NO_PAYMENT_INFO",
      };
    }

    // Cancel Stripe payment intent
    await this.stripeService.cancelStripePaymentIntent(booking);

    // Update booking status to canceled and save it
    const updatedBooking = await this.bookingRepository.updateBookingStatus(
      booking.id,
      BookingStatus.CANCELED
    );

    if (!updatedBooking) {
      return {
        error: "Failed to update booking status.",
        code: "UPDATE_FAILED",
      };
    }

    return {
      message: "Booking canceled successfully.",
      booking: updatedBooking,
    };
  }

  async requestRefund(id: number) {
    const booking = await this.bookingRepository.getBookingById(id);

    if (!booking) {
      return { error: "Booking not found.", code: "BOOKING_NOT_FOUND" };
    }

    // Validate booking status - only scheduled bookings can be refunded
    if (booking.status !== BookingStatus.SCHEDULED) {
      return {
        error: `The booking status is ${booking.status}. Only ${BookingStatus.SCHEDULED} bookings can be refunded.`,
        code: "INVALID_STATUS",
      };
    }

    // Ensure booking has payment information
    if (
      !booking.payment ||
      (!booking.payment.chargeId && !booking.payment.paymentIntentId)
    ) {
      return {
        error: "Booking does not have valid payment information for refund.",
        code: "NO_PAYMENT_INFO",
      };
    }

    await this.stripeService.createStripeRefund(booking);
    await this.bookingRepository.updateBookingStatus(
      booking.id,
      BookingStatus.AWAITING_REFUND
    );

    return {
      message: "Booking request for refund submitted.",
      booking,
    };
  }

  async confirmBooking(id: string, username: string) {
    const booking = await this.bookingRepository.getBookingById(parseInt(id));

    if (!booking) {
      return { error: "Booking not found.", code: "BOOKING_NOT_FOUND" };
    }

    // Validate user role (tutor or student)
    const isTutor = booking.hostUsername === username;
    const isStudent = booking.participantsUsernames.includes(username);

    if (!isTutor && !isStudent) {
      return {
        error: "User not authorized to confirm this booking.",
        code: "UNAUTHORIZED",
      };
    }

    // Validate booking status - only certain statuses can be confirmed
    const validBookingStatusesForConfirmation = [
      BookingStatus.AWAITING_TUTOR_CONFIRMATION,
      BookingStatus.AWAITING_STUDENT_CONFIRMATION,
    ];

    if (!validBookingStatusesForConfirmation.includes(booking.status)) {
      return {
        error: `The booking status is ${booking.status}. It cannot be confirmed.`,
        code: "INVALID_STATUS",
      };
    }

    // Update booking status
    booking.status =
      booking.type === BookingType.FREE_MEETING
        ? BookingStatus.SCHEDULED
        : BookingStatus.AWAITING_PAYMENT;

    // Process payment for lesson bookings
    if (booking.type === BookingType.LESSON) {
      const paymentData =
        await this.stripeService.createOrRegenerateStripeSessionForBooking(
          booking
        );
      booking.payment = {
        sessionId: paymentData.sessionId,
        sessionUrl: paymentData.sessionUrl,
      };
    }

    // Save updated booking
    await this.bookingRepository.saveBooking(booking);

    return {
      message: "Booking confirmed successfully.",
      booking,
    };
  }
}
