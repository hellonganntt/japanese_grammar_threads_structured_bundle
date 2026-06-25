import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const outputPath = path.join(rootDir, "data", "vocab-catalog.json");
const checkOnly = process.argv.includes("--check");
const manifest = JSON.parse(await readFile(path.join(rootDir, "data", "lessons.json"), "utf8"));
const cards = [];
const seen = new Set();

for(const lessonEntry of [...manifest.lessons].sort((left, right) => Number(left.lesson) - Number(right.lesson))){
  const lessonData = JSON.parse(await readFile(path.resolve(rootDir, lessonEntry.file), "utf8"));
  for(const [lessonIndex, item] of (lessonData.vocab || []).entries()){
    if(!item.id) throw new Error(`${lessonEntry.file}: vocab ${lessonIndex + 1} is missing an id.`);
    if(seen.has(item.id)) throw new Error(`Duplicate vocabulary id: ${item.id}`);
    seen.add(item.id);
    cards.push({
      id: item.id,
      lesson: Number(lessonEntry.lesson),
      lessonIndex,
      order: cards.length
    });
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
