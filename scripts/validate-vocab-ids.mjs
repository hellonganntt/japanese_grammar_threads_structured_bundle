import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "data", "lessons.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const seen = new Set();
let count = 0;

for(const lessonEntry of manifest.lessons){
  const lessonPath = path.resolve(rootDir, lessonEntry.file);
  const lessonData = JSON.parse(await readFile(lessonPath, "utf8"));

  if(String(lessonData.lesson) !== String(lessonEntry.lesson)){
    throw new Error(`${lessonEntry.file}: lesson number does not match the manifest.`);
  }

  for(const [index, item] of (lessonData.vocab || []).entries()){
    if(!item.id){
      throw new Error(`${lessonEntry.file}: vocab ${index + 1} is missing an id.`);
    }
    if(!new RegExp(`^l${lessonData.lesson}-v\\d{3,}$`).test(item.id)){
      throw new Error(`${lessonEntry.file}: invalid vocabulary id ${item.id}.`);
    }
    if(seen.has(item.id)){
      throw new Error(`Duplicate vocabulary id: ${item.id}`);
    }

    seen.add(item.id);
    count += 1;
  }
}

console.log(`Validated ${count} unique vocabulary IDs.`);
