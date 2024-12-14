import { TutorSeeder } from "./seeders/create-user-seeder";
import { SubjectsSeeder } from "./seeders/subjects-seeder";
import { join } from "path";

async function main() {
  const subjectsFilePath = join(process.cwd(), "seed", "subjects_levels.json");
  const avatarDirPath = join(process.cwd(), "seed", "avatars");
  try {
    await SubjectsSeeder.seedSubjectsAndLevels(subjectsFilePath);
    await TutorSeeder.seedTutorsFromAvatars(avatarDirPath);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

main();
