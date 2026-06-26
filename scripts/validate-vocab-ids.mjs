import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "data", "lessons.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const migrationPath = path.join(rootDir, "data", "id-migrations.json");
const idMigrations = JSON.parse(await readFile(migrationPath, "utf8").catch(() => "{}"));
const seen = new Set();
const validIds = new Set();
const validLevels = new Set(["N5", "N4", "N3", "N2", "N1"]);
let count = 0;

for(const lessonEntry of manifest.lessons){
  if(!validLevels.has(lessonEntry.level)){
    throw new Error(`${lessonEntry.file}: manifest entry must include a valid JLPT level: N5, N4, N3, N2, or N1.`);
  }

  const levelLower = lessonEntry.level.toLowerCase();
  const expectedLessonFile = `./data/${levelLower}/lesson-${lessonEntry.lesson}.json`;
  if(lessonEntry.file !== expectedLessonFile){
    throw new Error(`Lesson ${lessonEntry.lesson}: manifest file must be ${expectedLessonFile}.`);
  }

  const lessonPath = path.resolve(rootDir, lessonEntry.file);
  const lessonData = JSON.parse(await readFile(lessonPath, "utf8"));

  if(String(lessonData.lesson) !== String(lessonEntry.lesson)){
    throw new Error(`${lessonEntry.file}: lesson number does not match the manifest.`);
  }

  for(const [index, item] of (lessonData.vocab || []).entries()){
    if(!item.id){
      throw new Error(`${lessonEntry.file}: vocab ${index + 1} is missing an id.`);
    }
    if(!new RegExp(`^${levelLower}-l${lessonData.lesson}-v\\d{3,}$`).test(item.id)){
      throw new Error(`${lessonEntry.file}: invalid vocabulary id ${item.id}.`);
    }
    if(seen.has(item.id)){
      throw new Error(`Duplicate vocabulary id: ${item.id}`);
    }

    const expectedAudioPrefix = `./audio/${levelLower}/lesson-${lessonEntry.lesson}/`;
    for(const [label, audioPath] of Object.entries(item.audio || {})){
      if(typeof audioPath !== "string" || !audioPath.startsWith(expectedAudioPrefix)){
        throw new Error(`${lessonEntry.file}: vocab ${index + 1} has invalid ${label} audio path ${audioPath}. Expected ${expectedAudioPrefix}.`);
      }
    }

    seen.add(item.id);
    validIds.add(item.id);
    count += 1;
  }
}

for(const [legacyId, targetId] of Object.entries(idMigrations)){
  if(typeof legacyId !== "string" || typeof targetId !== "string"){
    throw new Error("data/id-migrations.json must map legacy ID strings to new ID strings.");
  }
  if(!/^l\d+-v\d{3,}$/.test(legacyId)){
    throw new Error(`Invalid legacy vocabulary id in migration map: ${legacyId}.`);
  }
  if(!validIds.has(targetId)){
    throw new Error(`Migration target does not exist in lesson data: ${targetId}.`);
  }
}

console.log(`Validated ${count} unique vocabulary IDs.`);
