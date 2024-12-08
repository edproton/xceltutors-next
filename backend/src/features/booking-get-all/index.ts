import { prisma } from "@/lib/prisma";
import {
  Booking,
  BookingStatus,
  BookingType,
  User,
  Prisma,
} from "@prisma/client";
import { DateTime } from "luxon";

type BookingWithRelations = Prisma.BookingGetPayload<{
  include: {
    host: {
      select: {
        id: true;
        name: true;
        image: true;
      };
    };
    participants: {
      select: {
        id: true;
        name: true;
        image: true;
      };
    };
  };
}>;

export enum BookingSortField {
  START_TIME = "START_TIME",
  CREATED_AT = "CREATED_AT",
}

export enum SortDirection {
  ASC = "asc",
  DESC = "desc",
}

export interface GetBookingsCommand {
  currentUser: User;
  page?: number;
  limit?: number;
  sort?: {
    field: BookingSortField;
    direction: SortDirection;
  };
  filters?: {
    startDate?: string;
    endDate?: string;
    status?: BookingStatus[];
    type?: BookingType;
    search?: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  metadata: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export class GetBookingsCommandHandler {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_LIMIT = 10;
  private static readonly MAX_LIMIT = 100;
  private static readonly DEFAULT_SORT = {
    field: BookingSortField.START_TIME,
    direction: SortDirection.DESC,
  };

  static async execute(
    command: GetBookingsCommand
  ): Promise<PaginatedResponse<BookingWithRelations>> {
    const page = Math.max(1, command.page || this.DEFAULT_PAGE);
    const limit = Math.min(
      this.MAX_LIMIT,
      Math.max(1, command.limit || this.DEFAULT_LIMIT)
    );
    const skip = (page - 1) * limit;
    const sort = command.sort || this.DEFAULT_SORT;

    const where = this.buildWhereClause(command);
    const orderBy = this.buildOrderByClause(sort);

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          host: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          participants: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      }),
    ]);

    return {
      items: bookings,
      metadata: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  private static buildOrderByClause(sort: {
    field: BookingSortField;
    direction: SortDirection;
  }): Prisma.BookingOrderByWithRelationInput[] {
    const primarySort: Prisma.BookingOrderByWithRelationInput = {};

    switch (sort.field) {
      case BookingSortField.START_TIME:
        primarySort.startTime = sort.direction;
        break;
      case BookingSortField.CREATED_AT:
        primarySort.createdAt = sort.direction;
        break;
      default:
        primarySort.startTime = SortDirection.DESC;
    }

    // Always add a secondary sort for consistency
    const secondarySort: Prisma.BookingOrderByWithRelationInput =
      sort.field === BookingSortField.START_TIME
        ? { createdAt: sort.direction }
        : { startTime: sort.direction };

    return [primarySort, secondarySort];
  }

  private static buildWhereClause(
    command: GetBookingsCommand
  ): Prisma.BookingWhereInput {
    const baseWhere: Prisma.BookingWhereInput = {
      OR: [
        { hostId: command.currentUser.id },
        {
          participants: {
            some: {
              id: command.currentUser.id,
            },
          },
        },
      ],
    };

    if (!command.filters) {
      return baseWhere;
    }

    const whereConditions: Prisma.BookingWhereInput[] = [baseWhere];

    // Add status filter
    if (command.filters.status?.length) {
      whereConditions.push({
        status: { in: command.filters.status },
      });
    }

    // Add type filter
    if (command.filters.type) {
      whereConditions.push({ type: command.filters.type });
    }

    // Add date range filters
    const dateFilters: Prisma.BookingWhereInput = {};

    if (command.filters.startDate) {
      const startDate = DateTime.fromISO(command.filters.startDate, {
        zone: "utc",
      });
      if (startDate.isValid) {
        dateFilters.startTime = { gte: startDate.toJSDate() };
      }
    }

    if (command.filters.endDate) {
      const endDate = DateTime.fromISO(command.filters.endDate, {
        zone: "utc",
      });
      if (endDate.isValid) {
        dateFilters.endTime = { lte: endDate.toJSDate() };
      }
    }

    if (Object.keys(dateFilters).length > 0) {
      whereConditions.push(dateFilters);
    }

    // Add search filter if provided
    if (command.filters.search?.trim()) {
      const searchTerm = command.filters.search.trim();
      whereConditions.push({
        OR: [
          {
            title: {
              contains: searchTerm,
              mode: "insensitive",
            },
          },
          {
            host: {
              name: {
                contains: searchTerm,
                mode: "insensitive",
              },
            },
          },
          {
            participants: {
              some: {
                name: {
                  contains: searchTerm,
                  mode: "insensitive",
                },
              },
            },
          },
        ],
      });
    }

    // Combine all conditions with AND
    return {
      AND: whereConditions,
    };
  }
}
