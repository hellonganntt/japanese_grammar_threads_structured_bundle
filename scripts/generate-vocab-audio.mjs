import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const lessonArg = process.argv.find(arg => arg.startsWith("--lesson="));
const itemsArg = process.argv.find(arg => arg.startsWith("--items="));
const lesson = lessonArg ? lessonArg.split("=")[1] : "36";
const updateJsonOnly = args.has("--update-json-only");
const force = args.has("--force");

const rootDir = process.cwd();
const lessonFile = path.join(rootDir, "data", `lesson-${lesson}.json`);
const audioDir = path.join(rootDir, "audio", `lesson-${lesson}`);
const publicAudioBase = `./audio/lesson-${lesson}`;
const apiKey = process.env.OPENAI_API_KEY;

const model = "gpt-4o-mini-tts";
const voice = "coral";
const instructions = [
  "Speak in clear, natural Japanese.",
  "Use a calm teacher-like voice and a slightly slow pace for language learners.",
  "Pronounce only the provided Japanese text without adding explanations."
].join(" ");

function parseItems(value){
  if(!value) return null;

  const indexes = value.split(",")
    .map(item => Number(item.trim()))
    .filter(Number.isInteger);

  if(indexes.some(index => index < 1)){
    throw new Error("--items must contain 1-based positive vocab numbers, for example --items=1,7,12.");
  }

  return new Set(indexes);
}

const selectedItems = parseItems(itemsArg?.split("=")[1]);

async function pathExists(filePath){
  try{
    await stat(filePath);
    return true;
  }catch(error){
    if(error.code === "ENOENT") return false;
    throw error;
  }
}

function audioPathsForIndex(index){
  const number = String(index + 1).padStart(3, "0");

  return {
    word: `${publicAudioBase}/vocab-${number}-word.mp3`,
    example: `${publicAudioBase}/vocab-${number}-example.mp3`
  };
}

function outputPathFromPublicPath(publicPath){
  return path.join(rootDir, publicPath.replace("./", "").replaceAll("/", path.sep));
}

async function generateAudio(text, outputPath){
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      instructions,
      response_format: "mp3"
    })
  });

  if(!response.ok){
    const body = await response.text();
    throw new Error(`OpenAI audio request failed (${response.status}): ${body}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, audioBuffer);
}

async function main(){
  const lessonData = JSON.parse(await readFile(lessonFile, "utf8"));

  if(!Array.isArray(lessonData.vocab)){
    throw new Error(`${lessonFile} must contain a vocab array.`);
  }

  let jsonChanged = false;

  lessonData.vocab.forEach((item, index) => {
    const audio = audioPathsForIndex(index);

    if(!item.audio || item.audio.word !== audio.word || item.audio.example !== audio.example){
      item.audio = audio;
      jsonChanged = true;
    }
  });

  if(jsonChanged){
    await writeFile(lessonFile, `${JSON.stringify(lessonData, null, 2)}\n`, "utf8");
    console.log(`Updated audio paths in data/lesson-${lesson}.json`);
  }else{
    console.log(`Audio paths already present in data/lesson-${lesson}.json`);
  }

  if(updateJsonOnly){
    console.log("Skipped audio generation because --update-json-only was provided.");
    return;
  }

  if(!apiKey){
    throw new Error("Set OPENAI_API_KEY before generating audio files.");
  }

  await mkdir(audioDir, { recursive: true });

  let generated = 0;
  let skipped = 0;

  for(const [index, item] of lessonData.vocab.entries()){
    const itemNumber = index + 1;
    if(selectedItems && !selectedItems.has(itemNumber)){
      continue;
    }

    const wordText = item.audioText?.word || item.reading || item.jp;
    const clips = [
      { label: "word", text: wordText, publicPath: item.audio.word },
      { label: "example", text: item.audioText?.example || item.example, publicPath: item.audio.example }
    ].filter(clip => clip.text);

    for(const clip of clips){
      const outputPath = outputPathFromPublicPath(clip.publicPath);
      const exists = await pathExists(outputPath);

      if(exists && !force){
        skipped += 1;
        console.log(`Skipped existing ${clip.publicPath}`);
        continue;
      }

      await mkdir(path.dirname(outputPath), { recursive: true });
      console.log(`Generating ${clip.publicPath}`);
      await generateAudio(clip.text, outputPath);
      generated += 1;
    }

    console.log(`Processed vocab ${itemNumber} / ${lessonData.vocab.length}`);
  }

  console.log(`Done. Generated ${generated} clip(s), skipped ${skipped} existing clip(s).`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
