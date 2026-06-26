import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const outputPath = path.join(rootDir, "data", "vocab-catalog.json");
const migrationPath = path.join(rootDir, "data", "id-migrations.json");
const checkOnly = process.argv.includes("--check");
const manifest = JSON.parse(await readFile(path.join(rootDir, "data", "lessons.json"), "utf8"));
const idMigrations = JSON.parse(await readFile(migrationPath, "utf8").catch(() => "{}"));
const cards = [];
const seen = new Set();
const legacyIdsByTarget = new Map();
const VALID_LEVELS = new Set(["N5", "N4", "N3", "N2", "N1"]);

for(const [legacyId, targetId] of Object.entries(idMigrations)){
  if(typeof legacyId !== "string" || typeof targetId !== "string") continue;
  const legacyIds = legacyIdsByTarget.get(targetId) || [];
  legacyIds.push(legacyId);
  legacyIdsByTarget.set(targetId, legacyIds);
}

for(const lessonEntry of [...manifest.lessons].sort((left, right) => Number(left.lesson) - Number(right.lesson))){
  if(!VALID_LEVELS.has(lessonEntry.level)){
    throw new Error(`Lesson ${lessonEntry.lesson} must include a valid JLPT level: N5, N4, N3, N2, or N1.`);
  }

  const lessonData = JSON.parse(await readFile(path.resolve(rootDir, lessonEntry.file), "utf8"));
  for(const [lessonIndex, item] of (lessonData.vocab || []).entries()){
    if(!item.id) throw new Error(`${lessonEntry.file}: vocab ${lessonIndex + 1} is missing an id.`);
    if(seen.has(item.id)) throw new Error(`Duplicate vocabulary id: ${item.id}`);
    seen.add(item.id);
    const card = {
      id: item.id,
      lesson: Number(lessonEntry.lesson),
      level: lessonEntry.level,
      lessonIndex,
      order: cards.length
    };
    const legacyIds = legacyIdsByTarget.get(item.id);
    if(legacyIds?.length) card.legacyIds = legacyIds;
    cards.push(card);
  }
}

const version = createHash("sha256").update(JSON.stringify(cards)).digest("hex").slice(0, 16);
const output = `${JSON.stringify({ version, cards }, null, 2)}\n`;

if(checkOnly){
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if(current !== output) throw new Error("data/vocab-catalog.json is stale. Run node scripts/generate-vocab-catalog.mjs.");
  console.log(`Catalog is current: ${cards.length} cards (${version}).`);
}else{
  await writeFile(outputPath, output, "utf8");
  console.log(`Generated ${cards.length} catalog cards (${version}).`);
}
