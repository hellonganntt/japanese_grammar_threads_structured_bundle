---
name: lesson-data-generator
description: Generate and integrate structured Japanese vocabulary lesson data from user-provided word lists for this project. Use when creating or updating the `vocab` collection in `data/{levelLower}/lesson-XX.json`, registering new lessons in `data/lessons.json`, assigning permanent SRS vocabulary IDs, regenerating `data/vocab-catalog.json`, preparing optional vocabulary audio, and validating the complete vocabulary-data pipeline.
---

# Lesson Data Generator

Create or update a lesson file from the user's input and fully integrate it into the lesson viewer and IndexedDB-backed SRS.

## Core Task

Turn the user's vocabulary list into a complete `data/{levelLower}/lesson-XX.json` file for the specified lesson number and JLPT level.

## Required Output

Write the lesson file as:

- `data/{levelLower}/lesson-XX.json`

Follow `data/lesson-schema.jsonc` exactly.

For a new lesson, also:

- add it to `data/lessons.json`
- regenerate `data/vocab-catalog.json`
- validate all permanent vocabulary IDs

Do not finish after writing only the lesson JSON.

## Content Rules

- Write all meanings, explanations, notes, tips, and review comments in Vietnamese.
- Use natural Japanese examples that a native speaker would actually say or write.
- Keep examples relevant to the target vocabulary.
- Prefer clear, practical, everyday Japanese unless the lesson topic calls for something more formal.

## Structure Rules

Include these top-level keys:

- `lesson`
- `vocab`

Do not add unrelated top-level content. If an existing lesson contains other legacy top-level collections, preserve them unchanged unless the user explicitly asks to remove them.

Each vocabulary item may contain:

- `id`
- `jp`
- `reading`
- `meaning`
- `pos`
- `note`
- `example`
- `audio`
- `audioText`

Follow the vocabulary item shape documented in `data/lesson-schema.jsonc`.

## Permanent Vocabulary IDs

- Give every vocabulary item an ID formatted as `{levelLower}-l{lesson}-v{number}`, with at least three zero-padded digits, for example `n4-l46-v001`.
- Make IDs globally unique across all lesson files.
- For a new lesson, assign IDs sequentially in the source order.
- When updating an existing lesson, preserve every existing ID even if items are reordered or edited.
- Never reuse an ID previously assigned to a different vocabulary item.
- Before assigning IDs in an existing lesson, inspect its current entries and continue from the highest relevant number for genuinely new items.

These IDs are the permanent keys for IndexedDB and Google Drive SRS schedules. Changing them loses the association with existing learner progress.

## Manifest and Catalog Integration

For a new lesson:

1. Add exactly one entry to `data/lessons.json`:

   ```json
   {
     "lesson": 46,
  "level": "N4",
  "file": "./data/n4/lesson-46.json"
   }
   ```

2. Keep manifest entries in ascending numerical lesson order.

After any vocabulary addition, removal, reorder, ID change, or lesson-manifest change, run:

```powershell
npm run catalog
```

Commit the resulting `data/vocab-catalog.json`. Do not edit that generated file manually.

## Optional Vocabulary Audio

- Audio fields are optional.
- If audio is not requested and no matching MP3 files exist, omit `audio` and `audioText`.
- If audio is requested, use the project generator:

  ```powershell
  node scripts/generate-vocab-audio.mjs --lesson=XX
  ```

- Use `--update-json-only` only when audio files will be supplied separately.
- Add `audioText` only when the visible spelling is unsuitable for correct TTS pronunciation.

## Generation Workflow

1. Read `data/lesson-schema.jsonc`, `data/lessons.json`, and the existing target lesson if present.
2. Read the user's lesson number and source items.
3. Organize the input into vocabulary entries.
4. Assign or preserve permanent vocabulary IDs.
5. Fill in Vietnamese meanings and explanations.
6. Add natural Japanese examples that fit the lesson.
7. Save the file as `data/{levelLower}/lesson-XX.json`.
8. Add a new lesson to `data/lessons.json` if it is not already registered.
9. Prepare audio only when requested or when matching audio assets are part of the task.
10. Run `npm run catalog`.
11. Run `npm test`.
12. Review content accuracy, generated-file changes, and formatting.
13. Fix every validation failure before finishing.

## Self-Review Checklist

Before completing the task, verify:

- the lesson number matches the file name
- the JSON is syntactically valid
- there are no trailing commas
- every required field exists
- Vietnamese is used where required
- Japanese examples sound natural
- readings and meanings are correct
- vocabulary notes and examples match the target word
- IDs are unique and stable
- the file matches the schema
- a new lesson appears exactly once in `data/lessons.json`
- the manifest lesson number and lesson-file number match
- `data/vocab-catalog.json` was regenerated after vocabulary changes
- audio paths point only to files that exist or will be supplied as part of the task
- `npm test` passes

In the final response, report the lesson file, whether the manifest and catalog changed, whether audio was generated, and the validation result.

Do not finish until the lesson is accurate, integrated, cleanly formatted, and all project checks pass.
