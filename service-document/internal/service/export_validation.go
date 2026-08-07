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

		// FR-EDT-06: a formula node with no LaTeX source is an insert the student
		// never filled in; it would export as a blank numbered line.
		for _, blockID := range collectEmptyFormulaBlockIDs(sec.Content) {
			violations = append(violations, grpcerr.ExportViolation{
				Type:        "EMPTY_FORMULA",
				Subject:     blockID,
				Description: fmt.Sprintf("формула в розділі «%s» не має вмісту", sec.Title),
			})
		}
	}

	// FR-EDT-07: a cross-reference resolves against the live numbering counters,
	// so one pointing at a deleted block would export as «[?]».
	known := make(map[string]struct{}, len(sections))
	for i := range sections {
		known[sections[i].ID] = struct{}{}
		for _, id := range collectBlockIDs(sections[i].Content) {
			known[id] = struct{}{}
		}
	}
	for i := range sections {
		for _, target := range collectCrossReferenceTargets(sections[i].Content) {
			if _, ok := known[target]; ok {
				continue
			}
			violations = append(violations, grpcerr.ExportViolation{
				Type:        "ORPHANED_CROSS_REFERENCE",
				Subject:     target,
				Description: fmt.Sprintf("перехресне посилання в розділі «%s» вказує на видалений об'єкт", sections[i].Title),
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

// collectEmptyFormulaBlockIDs walks ProseMirror JSON returning the block ids of
// formula nodes whose LaTeX source is blank. Inline formulas have no block id of
// their own, so they report the id of nothing — they are reported under an empty
// subject and the description carries the section.
func collectEmptyFormulaBlockIDs(node map[string]any) []string {
	out := make([]string, 0)
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		if n == nil {
			return
		}
		switch n["type"] {
		case "formulaBlock", "formulaInline":
			attrs, _ := n["attrs"].(map[string]any)
			latex, _ := attrs["latex"].(string)
			if strings.TrimSpace(latex) == "" {
				blockID, _ := attrs["blockId"].(string)
				out = append(out, blockID)
			}
		}
		content, ok := n["content"].([]any)
		if !ok {
			return
		}
		for _, child := range content {
			if childMap, ok := child.(map[string]any); ok {
				walk(childMap)
			}
		}
	}
	walk(node)
	return out
}

// collectCrossReferenceTargets returns the ids cross-reference nodes point at.
func collectCrossReferenceTargets(node map[string]any) []string {
	return collectAttr(node, "crossReference", "targetId")
}

// collectAttr walks ProseMirror JSON collecting a string attr in document
// order, optionally restricted to one node type ("" means any type).
func collectAttr(node map[string]any, nodeType, attr string) []string {
	out := make([]string, 0)
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		if n == nil {
			return
		}
		if nodeType == "" || n["type"] == nodeType {
			if attrs, ok := n["attrs"].(map[string]any); ok {
				if value, ok := attrs[attr].(string); ok && value != "" {
					out = append(out, value)
				}
			}
		}
		content, ok := n["content"].([]any)
		if !ok {
			return
		}
		for _, child := range content {
			if childMap, ok := child.(map[string]any); ok {
				walk(childMap)
			}
		}
	}
	walk(node)
	return out
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
