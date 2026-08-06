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
