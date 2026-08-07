package service

import (
	"testing"

	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

func paragraph(text string) map[string]any {
	return map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{
				"type":    "paragraph",
				"content": []any{map[string]any{"type": "text", "text": text}},
			},
		},
	}
}

func TestValidateForExport(t *testing.T) {
	version := &repository.TemplateVersion{Model: map[string]any{
		"fields": []any{
			map[string]any{"name": "topic", "label": "Тема роботи", "required": true},
			map[string]any{"name": "city", "label": "Місто", "required": false},
		},
	}}

	t.Run("clean document passes", func(t *testing.T) {
		doc := &repository.Document{Metadata: map[string]string{"topic": "Аналіз даних"}}
		sections := []repository.Section{{ID: "s1", Title: "Вступ", Required: true, Content: paragraph("текст")}}

		if got := validateForExport(doc, version, sections, nil); len(got) != 0 {
			t.Fatalf("expected no violations, got %+v", got)
		}
	})

	t.Run("required metadata field empty blocks", func(t *testing.T) {
		doc := &repository.Document{Metadata: map[string]string{"topic": "   "}}
		violations := validateForExport(doc, version, nil, nil)

		if len(violations) != 1 {
			t.Fatalf("expected 1 violation, got %+v", violations)
		}
		if violations[0].Type != "REQUIRED_FIELD_EMPTY" || violations[0].Subject != "topic" {
			t.Fatalf("unexpected violation: %+v", violations[0])
		}
	})

	t.Run("optional metadata field empty passes", func(t *testing.T) {
		doc := &repository.Document{Metadata: map[string]string{"topic": "Тема"}}
		if got := validateForExport(doc, version, nil, nil); len(got) != 0 {
			t.Fatalf("expected no violations, got %+v", got)
		}
	})

	t.Run("empty required section blocks", func(t *testing.T) {
		doc := &repository.Document{Metadata: map[string]string{"topic": "Тема"}}
		sections := []repository.Section{
			{ID: "s1", Title: "Вступ", Required: true, Content: paragraph("   ")},
			{ID: "s2", Title: "Додаток", Required: false, Content: nil},
		}

		violations := validateForExport(doc, version, sections, nil)
		if len(violations) != 1 || violations[0].Subject != "s1" {
			t.Fatalf("expected only s1 to block, got %+v", violations)
		}
	})

	t.Run("image-only section counts as filled", func(t *testing.T) {
		doc := &repository.Document{Metadata: map[string]string{"topic": "Тема"}}
		sections := []repository.Section{{
			ID: "s1", Required: true,
			Content: map[string]any{
				"type":    "doc",
				"content": []any{map[string]any{"type": "image", "attrs": map[string]any{"objectKey": "k"}}},
			},
		}}

		if got := validateForExport(doc, version, sections, nil); len(got) != 0 {
			t.Fatalf("expected no violations, got %+v", got)
		}
	})

	t.Run("orphaned citations block", func(t *testing.T) {
		doc := &repository.Document{Metadata: map[string]string{"topic": "Тема"}}
		violations := validateForExport(doc, version, nil, []string{"src-1", "src-2"})

		if len(violations) != 2 {
			t.Fatalf("expected 2 violations, got %+v", violations)
		}
		for _, v := range violations {
			if v.Type != "ORPHANED_CITATION" {
				t.Fatalf("unexpected violation type: %+v", v)
			}
		}
	})
}

func TestCollectCitationSourceIDs(t *testing.T) {
	content := map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{
				"type": "paragraph",
				"content": []any{
					map[string]any{"type": "text", "text": "перше "},
					map[string]any{"type": "citation", "attrs": map[string]any{"sourceId": "b"}},
					map[string]any{"type": "text", "text": " друге "},
					map[string]any{"type": "citation", "attrs": map[string]any{"sourceId": "a"}},
				},
			},
			map[string]any{
				"type": "paragraph",
				"content": []any{
					// Repeats keep their position: dedup happens in the caller,
					// which needs *first* occurrence order (FR-BIB-06).
					map[string]any{"type": "citation", "attrs": map[string]any{"sourceId": "b"}},
					map[string]any{"type": "citation", "attrs": map[string]any{"sourceId": ""}},
				},
			},
		},
	}

	got := collectCitationSourceIDs(content)
	want := []string{"b", "a", "b"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestCollectCitationSourceIDsEmptyDoc(t *testing.T) {
	if got := collectCitationSourceIDs(nil); len(got) != 0 {
		t.Fatalf("expected none, got %v", got)
	}
}

func TestCollectEmptyFormulaBlockIDs(t *testing.T) {
	content := map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{
				"type":  "formulaBlock",
				"attrs": map[string]any{"blockId": "f-filled", "latex": "E = mc^2"},
			},
			map[string]any{
				"type":  "formulaBlock",
				"attrs": map[string]any{"blockId": "f-blank", "latex": "   "},
			},
			map[string]any{
				"type": "paragraph",
				"content": []any{
					map[string]any{"type": "formulaInline", "attrs": map[string]any{"latex": "x_i"}},
					map[string]any{"type": "formulaInline", "attrs": map[string]any{"latex": ""}},
				},
			},
		},
	}

	got := collectEmptyFormulaBlockIDs(content)
	if len(got) != 2 {
		t.Fatalf("expected the blank block and the blank inline formula, got %v", got)
	}
	if got[0] != "f-blank" || got[1] != "" {
		t.Fatalf("unexpected subjects: %v", got)
	}
}

func TestValidateForExportBlocksEmptyFormula(t *testing.T) {
	doc := &repository.Document{Metadata: map[string]string{"topic": "Тема"}}
	version := &repository.TemplateVersion{Model: map[string]any{}}
	sections := []repository.Section{{
		ID:    "s1",
		Title: "Розділ 1",
		Content: map[string]any{
			"type": "doc",
			"content": []any{
				map[string]any{"type": "formulaBlock", "attrs": map[string]any{"blockId": "f1", "latex": ""}},
			},
		},
	}}

	violations := validateForExport(doc, version, sections, nil)
	if len(violations) != 1 || violations[0].Type != "EMPTY_FORMULA" || violations[0].Subject != "f1" {
		t.Fatalf("unexpected violations: %+v", violations)
	}
}

func TestValidateForExportBlocksOrphanCrossReference(t *testing.T) {
	doc := &repository.Document{Metadata: map[string]string{}}
	version := &repository.TemplateVersion{Model: map[string]any{}}
	sections := []repository.Section{{
		ID:    "s1",
		Title: "Розділ 1",
		Content: map[string]any{
			"type": "doc",
			"content": []any{
				map[string]any{
					"type":  "image",
					"attrs": map[string]any{"blockId": "img-1"},
				},
				map[string]any{
					"type":  "paragraph",
					"attrs": map[string]any{"blockId": "p-1"},
					"content": []any{
						// Resolves: points at the figure above.
						map[string]any{"type": "crossReference", "attrs": map[string]any{"targetId": "img-1"}},
						// Resolves: a whole section is a valid target too.
						map[string]any{"type": "crossReference", "attrs": map[string]any{"targetId": "s1"}},
						// Orphan: nothing carries this id any more.
						map[string]any{"type": "crossReference", "attrs": map[string]any{"targetId": "tbl-gone"}},
					},
				},
			},
		},
	}}

	violations := validateForExport(doc, version, sections, nil)
	if len(violations) != 1 {
		t.Fatalf("expected only the orphan to block, got %+v", violations)
	}
	if violations[0].Type != "ORPHANED_CROSS_REFERENCE" || violations[0].Subject != "tbl-gone" {
		t.Fatalf("unexpected violation: %+v", violations[0])
	}
}
