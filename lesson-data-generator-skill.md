# Lesson Data Generator Skill

Use this skill when the user asks you to create or update a lesson data file for the Japanese vocabulary lessons project.

## Goal

Generate a complete `data/{levelLower}/lesson-XX.json` file from user-provided inputs:

- a list of vocabulary items

plus the lesson number and JLPT level they belong to.

The final output must follow `data/lesson-schema.jsonc` and be valid JSON.

## Input You Should Expect

The user will give some or all of the following:

- `lesson`: the lesson number
- `vocab`: a list of vocabulary items

If the user gives raw notes instead of structured fields, reorganize them into the lesson schema.

## Required Output

Create a file named:

- `data/{levelLower}/lesson-XX.json`

where `XX` is the lesson number.

The file must contain:

- `lesson`
- `vocab`

## Content Rules

### Vietnamese

All of these must be written in Vietnamese:

- meanings
- explanations
- notes
- review comments
- tips

### Japanese Examples

Examples must use natural Japanese that a native speaker would actually use.

- Prefer simple, realistic daily-life sentences.
- Avoid unnatural textbook-style wording when a natural alternative exists.
- Make sure examples match the vocabulary meaning.
- Do not translate examples into Japanese that sounds forced or machine-made.

### Accuracy

Check that:

- kanji readings are correct
- vocabulary readings are correct
- examples fit the target point
- Vietnamese translations match the Japanese meaning

If something is uncertain, do not guess silently. Mark it clearly in your internal review and revise the item before finalizing if possible.

## Schema Rules

Follow `data/lesson-schema.jsonc` exactly.

General requirements:

- `lesson` must be a number
- `vocab` must be an array

For each vocabulary item:

- `id` is required and must use `{levelLower}-l{lesson}-v{number}`, for example `n4-l46-v001`
- `jp` is required
- `reading` is optional but preferred when useful
- `meaning` is required
- `pos` is optional
- `note` is optional
- `example` is optional

## Generation Workflow

When asked to create a lesson file:

1. Read the user input carefully.
2. Identify whether the lesson needs vocab.
3. Organize the content into the lesson schema.
4. Write Vietnamese explanations that are clear and concise.
5. Use natural Japanese example sentences.
6. Ensure all IDs are stable, descriptive, and lowercase with hyphens.
7. Save the result as `data/{levelLower}/lesson-XX.json`.
8. Validate the JSON structure.
9. Review content accuracy and formatting.
10. Fix any issues before finishing.

## Self-Review Checklist

Before you finish, verify all of the following:

- The file name matches the lesson number.
- The JSON is syntactically valid.
- No trailing commas exist.
- All required keys are present.
- Vietnamese text is used where required.
- Japanese examples sound natural.
- Section IDs and point IDs are unique within the file.
- The structure matches the schema.

## Review Standard

The lesson is not ready until:

- the content is accurate,
- the formatting is clean,
- the JSON is valid,
- and the file matches the schema.

If any issue remains, revise the file and review again.

## Suggested Response Style

When completing the task, report:

- the file created or updated
- the lesson number
- any notable content choices or corrections made

Keep the response brief and practical.
