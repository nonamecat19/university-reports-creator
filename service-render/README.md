# service-render

Stateless docx template parsing, docx export merge, PDF conversion, and CSL
bibliography rendering (FR-ARC-03, FR-API-11). Called only by
service-document (FR-ARC-07).

```
uv sync
uv run python -m render
```

Requires a `soffice` (LibreOffice) binary on PATH for `.doc` conversion and
PDF export; docx↔docx template parsing/merging works without it.
