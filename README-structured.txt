JAPANESE GRAMMAR OUTLINE - STRUCTURED JSON

Files:
- japanese_grammar_threads_structured.html
- grammar-data-structured.json
- data/lesson-36.json

The JSON stores lesson content as collapsible grammar sections.

Top-level lesson shape:
{
  "lesson": 36,
  "vocab": [],
  "kanji": [],
  "grammarSections": []
}

Each grammar section uses:
{
  "id": "lesson-grammar",
  "title": "Ngu phap",
  "open": true,
  "points": []
}

Each grammar point uses:
{
  "id": "unique-key",
  "title": "...",
  "tag": "...",
  "lesson": 36,
  "sections": [],
  "notes": []
}

Each point's sections array supports:
- text
- pattern
- example_jp
- translation
- tip

Extra examples, drills, reminders, and related explanations belong in notes.
Notes can be plain text or can contain their own sections and nested notes.

Bold text can be written with simple markers:
  **noi dung in dam**

Run:
  py -m http.server 8000

Open:
  http://localhost:8000/japanese_grammar_threads_structured.html
