package service

import (
	"fmt"
	"strings"

	"github.com/nnc/university-reports-creator/pkg/shared/grpcerr"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

// validateForExport is the server half of the pre-export gate (FR-EXP-06).
// The client renders the same checks as a checklist dialog before it even
// calls; this one is authoritative and returns only *blocking* findings —
// non-blocking lint (unreferenced figures, word-count targets) rides back as
// render warnings on the job instead.
func validateForExport(
	doc *repository.Document,
	version *repository.TemplateVersion,
	sections []repository.Section,
	orphanedCitations []string,
) []grpcerr.ExportViolation {
	violations := make([]grpcerr.ExportViolation, 0)

	model, err := parseTemplateModel(version.Model)
	if err == nil && model != nil {
		for _, field := range model.Fields {
			if !field.Required {
				continue
			}
			if strings.TrimSpace(doc.Metadata[field.Name]) == "" {
				violations = append(violations, grpcerr.ExportViolation{
					Type:        "REQUIRED_FIELD_EMPTY",
					Subject:     field.Name,
					Description: fmt.Sprintf("обов'язкове поле «%s» не заповнено", labelOr(field.Label, field.Name)),
				})
			}
		}
	}

	for i := range sections {
		sec := &sections[i]
		if sec.Required && isEmptyContent(sec.Content) {
			violations = append(violations, grpcerr.ExportViolation{
				Type:        "REQUIRED_SECTION_EMPTY",
				Subject:     sec.ID,
				Description: fmt.Sprintf("обов'язковий розділ «%s» порожній", sec.Title),
			})
		}
	}

	// FR-BIB-07: a citation whose source was deleted would export as a number
	// pointing at nothing, so it blocks rather than degrading silently.
	for _, id := range orphanedCitations {
		violations = append(violations, grpcerr.ExportViolation{
			Type:        "ORPHANED_CITATION",
			Subject:     id,
			Description: "посилання в тексті вказує на видалене джерело",
		})
	}

	return violations
}

func labelOr(label, name string) string {
	if strings.TrimSpace(label) != "" {
		return label
	}
	return name
}

// isEmptyContent reports whether a ProseMirror doc holds no text at all —
// a doc with one empty paragraph (what a freshly created section contains)
// counts as empty.
func isEmptyContent(content map[string]any) bool {
	if len(content) == 0 {
		return true
	}
	return !hasText(content)
}

func hasText(node map[string]any) bool {
	if text, ok := node["text"].(string); ok && strings.TrimSpace(text) != "" {
		return true
	}
	// Leaf blocks carry meaning without text: an image or formula alone is
	// legitimate section content.
	switch node["type"] {
	case "image", "formulaBlock", "table":
		return true
	}
	content, ok := node["content"].([]any)
	if !ok {
		return false
	}
	for _, child := range content {
		if childMap, ok := child.(map[string]any); ok && hasText(childMap) {
			return true
		}
	}
	return false
}
