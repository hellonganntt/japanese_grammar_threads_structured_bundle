# Japanese Grammar Outline

Static Japanese grammar lesson viewer backed by structured JSON data.

## Files

- `japanese_grammar_threads_structured.html` - browser page shell
- `assets/styles.css` - UI styles
- `assets/app.js` - data loading and rendering logic
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
