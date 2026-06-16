---
name: lesson-data-generator
description: Generate structured Japanese lesson data files from user-provided vocab, kanji, or grammar inputs for this project. Use when creating or updating `data/lesson-XX.json` files that must follow `data/lesson-schema.jsonc`, with Vietnamese meanings/explanations/notes, natural native-level Japanese examples, and a final self-review for accuracy and valid JSON.
---

# Lesson Data Generator

Create or update a lesson file from the user's input and make it ready for use in the lesson viewer.

## Core Task

Turn the user's list of:

- vocabulary items
- kanji items
- grammar points

into a complete `data/lesson-XX.json` file for the specified lesson number.

## Required Output

Write the lesson file as:

- `data/lesson-XX.json`

Follow `data/lesson-schema.jsonc` exactly.

## Content Rules

- Write all meanings, explanations, notes, tips, and review comments in Vietnamese.
- Use natural Japanese examples that a native speaker would actually say or write.
- Keep examples relevant to the target vocabulary, kanji, or grammar point.
- Prefer clear, practical, everyday Japanese unless the lesson topic calls for something more formal.

## Kanji Examples

When generating kanji entries, include up to 5 relevant example words if possible.

- Prefer examples that match the kanji's JLPT level or the closest practical level for the lesson.
- Choose words that show common, useful, and realistic usage.
- If five good examples are not available, include as many accurate examples as possible without forcing unnatural words.
- Make sure each example word, reading, and meaning are correct and relevant to the kanji.

## Structure Rules

Include these top-level keys:

- `lesson`
- `vocab`
- `kanji`
- `grammarSections`

For grammar content:

- give each section and point a stable lowercase hyphenated `id`
- use `sections` for the main explanation blocks
- use `notes` for extra remarks, reminders, drills, and nested explanations

Use only the supported section types:

- `text`
- `pattern`
- `example_jp`
- `translation`
- `tip`

## Generation Workflow

1. Read the user's lesson number and source items.
2. Organize the input into vocab, kanji, and grammar content.
3. Fill in Vietnamese meanings and explanations.
4. Add natural Japanese examples that fit the lesson.
5. Save the file as `data/lesson-XX.json`.
6. Validate the JSON structure.
7. Review content accuracy and formatting.
8. Fix any issues before finishing.

## Self-Review Checklist

Before completing the task, verify:

- the lesson number matches the file name
- the JSON is syntactically valid
- there are no trailing commas
- every required field exists
- Vietnamese is used where required
- Japanese examples sound natural
- readings and meanings are correct
- grammar explanations match the examples
- IDs are unique and stable
- the file matches the schema

Do not finish until the lesson is accurate, cleanly formatted, and valid JSON.
