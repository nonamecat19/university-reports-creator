"""Prompt templates for AI features (FR-AI-07).

Versioned in service-ai/prompts/, not inlined in code.
"""

from __future__ import annotations

ACADEMIC_UKRAINIAN_SYSTEM = """Ти — академічний помічник для написання звітів українською мовою.

Правила:
1. Використовуй формальний академічний стиль.
2. Не використовуй першу особу однини (я, мене, мої).
3. Уникай канцеляризмів, тавтологій, англіцизмів.
4. Дотримуйся стилю ДСТУ 3008:2015.
5. Відповідай українською мовою, якщо не вказано інше.
6. Для наукових робіт використовуй імперсональні конструкції.
"""

ANALYZE_DOCUMENT = """Проаналізуй академічний звіт і знайди проблеми.

Тема: {topic}
Тип звіту: {report_type}

Структура звіту:
{sections_summary}

Повний текст:
{content}

Поверни JSON з масивом знахідок:
{{
  "findings": [
    {{
      "section_id": "string",
      "anchor_text": "string — точний текст-якір з документа",
      "severity": "info|warning|error",
      "category": "structure|topic_relevance|conclusions|coherence|formatting",
      "message": "string — пояснення проблеми українською"
    }}
  ]
}}

Категорії:
- structure: відсутні/порожні обов'язкові частини, вступ без об'єкта/предмета/мети/завдань
- topic_relevance: зміст секції не відповідає темі
- conclusions: висновки не покривають заявлені завдання
- coherence: логічні розриви, повтори
- formatting: таблиці/малюнки не згадані в тексті, не згадані джерела"""

DRAFT_SECTION = """Напиши чернетку секції академічного звіту.

Тема звіту: {topic}
Тип звіту: {report_type}
Назва секції: {section_title}
{bullet_points}

Пиши українською академічною мовою. Не використовуй першу особу.
Формат: простий текст, без markdown."""

CONTINUE_WRITING = """Продовж текст академічного звіту.

Тема: {topic}
Тип звіту: {report_type}
Назва секції: {section_title}

Попередній текст:
{preceding_text}

Продовж у тому ж стилі та на ту ж тему. Не повторюй те, що вже написано.
Не додавай заголовків і не підсумовуй написане — просто продовж думку.
Формат: простий текст, без markdown."""

# Selection transforms (FR-AI-06). One template per transform, chosen by
# TRANSFORM_INSTRUCTIONS below — the shared frame keeps the document context
# and the output contract identical across transforms, so the editor can treat
# every result the same way.
TRANSFORM_SELECTION = """{instruction}

Тема звіту: {topic}
Тип звіту: {report_type}

Текст:
{text}

Поверни ЛИШЕ перероблений текст, без пояснень, лапок і markdown."""

TRANSFORM_INSTRUCTIONS = {
    "rephrase": "Переформулюй наведений фрагмент академічного звіту, зберігши зміст.",
    "expand": "Розгорни наведений фрагмент академічного звіту: додай деталізацію та пояснення, не змінюючи тверджень.",
    "condense": "Стисни наведений фрагмент академічного звіту, зберігши всі суттєві твердження.",
    "academic": (
        "Переклади наведений фрагмент в академічний стиль: прибери розмовні звороти, "
        "заміни першу особу однини на імперсональні конструкції, прибери канцеляризми."
    ),
}

TRANSLATE_INSTRUCTIONS = {
    "uk": "Переклади наведений фрагмент українською академічною мовою.",
    "en": "Translate the fragment below into English academic prose.",
}

GRAMMAR_CHECK = """Перевір український текст на граматику, стиль та академічність.

Текст:
{text}

Поверни JSON з пропозиціями:
{{
  "suggestions": [
    {{
      "original": "оригінальний текст",
      "replacement": "виправлений текст",
      "message": "пояснення",
      "rule_id": "style_uk|grammar_uk"
    }}
  ]
}}"""

SOURCE_SUGGESTIONS = """Запропонуй джерела для секції академічного звіту.

Тема звіту: {topic}
Текст секції:
{section_text}

Поверни JSON з пропозиціями:
{{
  "search_queries": ["пошуковий запит 1", "пошуковий запит 2"],
  "candidate_sources": [
    {{
      "title": "Назва джерела",
      "authors": "Автори",
      "year": "2024",
      "type": "journal|book|conference|web",
      "relevance": "коротке пояснення чому підходить"
    }}
  ]
}}"""

CITATION_CHECK = """Перевір, чи підтримує джерело твердження.

Твердження: {claim}
Джерело: {source_title}
Анотація: {source_abstract}

Чи підтримує це джерело це твердження? Відповідай JSON:
{{
  "supported": true|false,
  "confidence": 0.0-1.0,
  "explanation": "пояснення"
}}"""

FREEFORM_PARSE = """Розпізнай бібліографічний опис з вільного тексту.

Текст:
{raw_text}

Поверни JSON з елементами CSL-JSON:
{{
  "type": "article-journal|book|chapter|paper-conference",
  "title": "назва",
  "author": [{{"family": "Прізвище", "given": "Ім'я"}}],
  "issued": {{"date-parts": [[2024]]}},
  "DOI": "якщо є",
  "URL": "якщо є",
  "publisher": "видавець",
  "volume": "том",
  "issue": "номер",
  "page": "сторінки"
}}"""


def format_prompt(template: str, **kwargs: str) -> str:
    """Format a prompt template with the given variables."""
    return template.format(**kwargs)
