import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

interface Level {
  name: string;
}

interface SubjectData {
  subject: string;
  levels: Level[];
}

export class SubjectsSeeder {
  private static prisma = new PrismaClient();

  public static async seedSubjectsAndLevels(filePath: string): Promise<void> {
    try {
      const jsonData = readFileSync(filePath, "utf-8");
      const subjectsData: SubjectData[] = JSON.parse(jsonData);

      console.log("Starting subjects and levels seed...");

      await this.createSubjectsWithLevels(subjectsData);

      console.log("Subjects and levels seed completed successfully");
    } catch (error) {
      console.error("Error during subjects and levels seed:", error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  private static async createSubjectsWithLevels(
    subjectsData: SubjectData[]
  ): Promise<void> {
    for (const data of subjectsData) {
      const subject = await this.prisma.subject.upsert({
        where: { name: data.subject },
        update: {},
        create: { name: data.subject },
      });

      console.log(`Created subject: ${subject.name}`);

      await this.createLevelsForSubject(subject.id, data.levels, subject.name);
    }
  }

  private static async createLevelsForSubject(
    subjectId: number,
    levels: Level[],
    subjectName: string
  ): Promise<void> {
    for (const level of levels) {
      await this.prisma.level.upsert({
        where: {
          name_subjectId: {
            name: level.name,
            subjectId: subjectId,
          },
        },
        update: {},
        create: {
          name: level.name,
          subjectId: subjectId,
        },
      });

      console.log(`Created level: ${level.name} for subject: ${subjectName}`);
    }
  }
}
