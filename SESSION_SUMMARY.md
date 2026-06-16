# Session Summary

## Project State

This folder is a static Japanese grammar lesson viewer. It runs from a local web server and loads structured lesson data from JSON files.

Run:

```powershell
py -m http.server 8000
```

Open:

```text
http://localhost:8000/japanese_grammar_threads_structured.html
```

## Current Shape

- Lesson data is split by lesson file under `data/`.
- `data/lessons.json` is the lesson manifest.
- Vocabulary is lesson-level in `vocab`.
- Kanji is lesson-level in `kanji`.
- Grammar is lesson-level in `grammarSections`.
- Each grammar section is collapsible.
- Each grammar point inside a section is also collapsible.
- Extra examples, drills, reminders, and related explanations live in `notes`.

Top-level lesson shape:

```json
{
  "lesson": 36,
  "vocab": [],
  "kanji": [],
  "grammarSections": []
}
```

Grammar section shape:

```json
{
  "id": "lesson-grammar",
  "title": "Ngữ pháp",
  "open": true,
  "points": []
}
```

Grammar point shape:

```json
{
  "id": "unique-key",
  "title": "...",
  "tag": "...",
  "lesson": 36,
  "sections": [],
  "notes": []
}
```

## Current Lesson 36 Data

`data/lesson-36.json` currently contains:

- `1` grammar section
- `4` grammar points
- `8` vocabulary entries
- `6` kanji entries

## Web UI

The page currently has:

- Lesson chips from `data/lessons.json`
- Collapsible vocabulary panel
- Collapsible kanji panel
- Collapsible grammar section
- Collapsible grammar points
- Dark/light theme toggle

## Validation Commands

```powershell
node --check assets\app.js
```

```powershell
Get-ChildItem data -Filter *.json | ForEach-Object {
  py -m json.tool $_.FullName > $null
}
py -m json.tool grammar-data-structured.json > $null
```
