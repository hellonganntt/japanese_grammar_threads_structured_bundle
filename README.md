# Japanese Grammar Outline

Static Japanese grammar lesson viewer backed by structured JSON data.

## Files

- `japanese_grammar_threads_structured.html` - browser page shell
- `assets/styles.css` - UI styles
- `assets/app.js` - data loading and rendering logic
- `scripts/generate-vocab-audio.mjs` - optional vocab audio generator
- `data/lessons.json` - lesson manifest used by the lesson selector
- `data/lesson-36.json` - structured lesson data for lesson 36
- `grammar-data-structured.json` - combined data copy
- `README-structured.txt` - original bundle notes

## Run locally

Start a local web server from this folder:

```powershell
py -m http.server 8000
```

Open:

```text
http://localhost:8000/index.html
```

Opening the HTML file directly with `file://` may fail because browsers often block JSON loading from local files.

## Vocabulary Audio

Vocabulary items can include optional static audio paths:

```json
{
  "jp": "話せる",
  "reading": "はなせる",
  "meaning": "can speak",
  "example": "日本語が少し話せるようになりました。",
  "audio": {
    "word": "./audio/lesson-36/vocab-001-word.mp3",
    "example": "./audio/lesson-36/vocab-001-example.mp3"
  }
}
```

The app never uses an OpenAI API key in the browser. The key is only needed when generating MP3 files.

Set the key in the current PowerShell session:

```powershell
$env:OPENAI_API_KEY="sk-..."
```

Generate missing audio for lesson 36:

```powershell
node scripts/generate-vocab-audio.mjs --lesson=36
```

The script skips existing MP3 files by default so reruns do not re-spend API usage. Use `--force` only when you intentionally want to regenerate existing clips.

Regenerate only selected vocab items by their 1-based number:

```powershell
node scripts/generate-vocab-audio.mjs --lesson=36 --items=3,7,12 --force
```

If a word or sentence is pronounced incorrectly, add an `audioText` override to that vocab item. The visible lesson text stays the same, but generation uses the override:

```json
{
  "jp": "上手に",
  "reading": "じょうずに",
  "example": "彼は日本語を上手に話します。",
  "audioText": {
    "word": "じょうずに",
    "example": "かれは、にほんごを、じょうずに、はなします。"
  }
}
```

To update JSON audio paths without calling OpenAI:

```powershell
node scripts/generate-vocab-audio.mjs --lesson=36 --update-json-only
```

## Data Shape

Lesson data is split by file. To add another lesson:

1. Create a file like `data/lesson-37.json`.
2. Add `{ "lesson": 37, "file": "./data/lesson-37.json" }` to `data/lessons.json`.
3. Store that lesson's shared vocabulary in `vocab`, kanji in `kanji`, and grammar outline in `grammarSections`.

Lesson files use this shape:

```json
{
  "lesson": 36,
  "vocab": [],
  "kanji": [],
  "grammarSections": [
    {
      "id": "lesson-grammar",
      "title": "Ngữ pháp",
      "open": true,
      "points": [
        {
          "id": "you-ni-purpose",
          "title": "Vる / Vない + ように、V2",
          "tag": "Mẫu 2",
          "sections": [
            { "type": "text", "text": "Main explanation..." },
            { "type": "pattern", "text": "Pattern..." }
          ],
          "notes": [
            { "text": "Short note..." }
          ]
        }
      ]
    }
  ]
}
```

`grammarSections` render as collapsible grammar sections. Each item in `points` renders as a collapsible grammar point. The point body uses `sections` for the main explanation and `notes` for supporting material such as examples, drills, reminders, and related explanations.

For a commented version you can hand to an LLM, see [`data/lesson-schema.jsonc`](./data/lesson-schema.jsonc). It is the same structure, but annotated field-by-field so generation prompts can follow it exactly.

Supported section types:

- `text`
- `pattern`
- `example_jp`
- `translation`
- `tip`

Bold text can be written with `**text**` markers. Vocabulary and kanji stay lesson-level and appear in their own collapsible panels above the grammar outline.
