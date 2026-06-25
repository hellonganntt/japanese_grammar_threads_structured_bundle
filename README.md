# Japanese Vocabulary Study App

Static Japanese vocabulary study app backed by structured lesson JSON. It includes lesson browsing, flashcards, quizzes, audio, and a local-first spaced-repetition Daily Review.

## Files

- `index.html` - browser page shell
- `assets/styles.css` - UI styles
- `assets/app.js` - data loading and rendering logic
- `assets/srs.js` - card-level SRS scheduling and Drive snapshot validation
- `assets/srs-db.js` - IndexedDB persistence, indexed queue queries, and migration
- `assets/config.js` - public browser configuration such as the Google OAuth client ID
- `scripts/generate-vocab-audio.mjs` - optional vocab audio generator
- `data/lessons.json` - lesson manifest used by the lesson selector
- `data/vocab-catalog.json` - compact generated catalog used for SRS startup
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

## Daily Review and SRS

Daily Review loads the compact vocabulary catalog at startup and fetches full lesson data only when it is needed. It presents:

- all cards currently due
- up to 10 unseen cards per local calendar day in lesson order
- an option to learn another batch of up to 10 words after clearing the review queue
- Japanese-first recall cards with answer reveal
- `Again`, `Hard`, `Good`, and `Easy` ratings

Progress is saved immediately in the browser's IndexedDB database:

```text
japanese-vocab-srs
```

The database stores one record per vocabulary card, so reviewing a card does not rewrite the complete collection. Indexed indexes support due-card ordering, catalog ordering, daily-new limits, and dashboard counts for collections of 10,000 or more cards.

Existing schema version 1 or 2 progress under `localStorage` key `japaneseVocabSrs:v1` is imported once. The legacy value is retained as a recovery backup but is no longer updated. Historical daily activity, goals, and streaks are intentionally not imported. The 10-new-cards-per-local-day limit is derived from each card's `introducedAt` timestamp.

Lesson JSON remains read-only. Every vocabulary item has a permanent ID such as `l36-v001`; do not change an existing ID when reordering or editing vocabulary.

Generate the compact catalog after editing lesson vocabulary:

```powershell
npm run catalog
```

Run all scheduler, IndexedDB, Drive snapshot, catalog, and ID checks with:

```powershell
npm install
npm test
```

## Optional Google Drive Sync

Google Drive sync stores `japanese-vocab-progress.json` in the signed-in account's private Drive `appDataFolder`. The app remains fully usable without Drive.

Setup:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID with application type **Web application**.
5. Add authorized JavaScript origins for each URL used to run the app, for example:

```text
http://localhost:8000
https://YOUR_GITHUB_USERNAME.github.io
```

6. Put the public client ID in `assets/config.js`:

```js
window.APP_CONFIG = {
  googleClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com"
};
```

The client ID is public browser configuration, not a secret. Never add a client secret or access token to the repository.

Use **Connect Drive** once per browser tab session. The short-lived Google access token is kept in `sessionStorage`, so the connection survives page refreshes in the same tab but is cleared when the tab closes or the token expires. The app stores schema version 3 snapshots containing introduced card schedules only. It imports older version 1 and 2 snapshots, discards their activity history, merges cards by each card's latest `updatedAt`, and uploads the upgraded snapshot. If a review occurs during upload, the local revision remains dirty for the next sync. If authorization expires or the device is offline, progress remains safe in IndexedDB.

## Vocabulary Audio

Vocabulary items can include optional static audio paths:

```json
{
  "id": "l36-v001",
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
4. Run `npm run catalog` and commit the updated `data/vocab-catalog.json`.

Lesson files use this shape:

```json
{
  "lesson": 36,
  "vocab": [
    {
      "id": "l36-v001",
      "jp": "...",
      "meaning": "..."
    }
  ],
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
