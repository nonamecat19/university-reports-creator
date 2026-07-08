package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const sectionTable = "section"

type Section struct {
	// ID is derived from RawID after decode (see idHydrator) — the driver's
	// CBOR decoder only writes record-id tags into a models.RecordID field.
	ID                string          `json:"-"`
	RawID             models.RecordID `json:"id"`
	DocumentID        string          `json:"document_id"`
	TemplateSectionID string          `json:"template_section_id"`
	Title             string          `json:"title"`
	Kind              string          `json:"kind"`
	OrderIndex        int             `json:"order_index"`
	Required          bool            `json:"required"`
	Revision          int             `json:"revision"`
	// Content is a generic value (not json.RawMessage): the driver encodes/
	// decodes via CBOR, not encoding/json, so RawMessage would round-trip as
	// an opaque byte string instead of the FLEXIBLE object it actually is.
	Content   map[string]any `json:"content"`
	UpdatedAt time.Time      `json:"updated_at"`
}

func (s *Section) hydrateID() { s.ID = idString(s.RawID) }

type SectionRepository struct {
	db *surrealdb.DB
}

func NewSectionRepository(db *surrealdb.DB) *SectionRepository {
	return &SectionRepository{db: db}
}

func (r *SectionRepository) GetByID(ctx context.Context, documentID, id string) (*Section, error) {
	const q = `SELECT * FROM type::record($table, $id) WHERE document_id = $document_id`
	res, err := surrealdb.Query[[]Section](ctx, r.db, q, map[string]any{
		"table": sectionTable, "id": id, "document_id": documentID,
	})
	if err != nil {
		return nil, fmt.Errorf("get section: %w", err)
	}
	return single(res)
}

func (r *SectionRepository) ListByDocument(ctx context.Context, documentID string) ([]Section, error) {
	const q = `SELECT * FROM section WHERE document_id = $document_id ORDER BY order_index ASC`
	res, err := surrealdb.Query[[]Section](ctx, r.db, q, map[string]any{"document_id": documentID})
	if err != nil {
		return nil, fmt.Errorf("list sections: %w", err)
	}
	return rows(res)
}

func (r *SectionRepository) Add(ctx context.Context, documentID, title, kind string, order int) (*Section, error) {
	id := uuid.New().String()
	now := time.Now()

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, template_section_id: '', title: $title, kind: $kind,
		order_index: $order_index, required: false, revision: 0, content: {}, updated_at: $updated_at
	}`
	res, err := surrealdb.Query[[]Section](ctx, r.db, q, map[string]any{
		"table": sectionTable, "id": id, "document_id": documentID, "title": title,
		"kind": kind, "order_index": order, "updated_at": now,
	})
	if err != nil {
		return nil, fmt.Errorf("add section: %w", err)
	}
	section, err := single(res)
	if err != nil {
		return nil, err
	}
	if section == nil {
		return nil, status.Error(codes.Internal, "add section: no row returned")
	}
	return section, nil
}

// AddFromTemplate instantiates a section from a confirmed TemplateModel
// region (FR-EDT-01: "prefilled with template example content") when a
// document is created from a template.
func (r *SectionRepository) AddFromTemplate(
	ctx context.Context,
	documentID, templateSectionID, title, kind string,
	order int,
	required bool,
	content map[string]any,
) (*Section, error) {
	id := uuid.New().String()
	now := time.Now()

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, template_section_id: $template_section_id, title: $title, kind: $kind,
		order_index: $order_index, required: $required, revision: 0, content: $content, updated_at: $updated_at
	}`
	res, err := surrealdb.Query[[]Section](ctx, r.db, q, map[string]any{
		"table": sectionTable, "id": id, "document_id": documentID,
		"template_section_id": templateSectionID, "title": title, "kind": kind,
		"order_index": order, "required": required, "content": content, "updated_at": now,
	})
	if err != nil {
		return nil, fmt.Errorf("add section from template: %w", err)
	}
	section, err := single(res)
	if err != nil {
		return nil, err
	}
	if section == nil {
		return nil, status.Error(codes.Internal, "add section: no row returned")
	}
	return section, nil
}

// UpdateContent writes content_json, bumping revision, rejecting a stale
// expectedRevision (FR-EDT-09/FR-DAT-02). Sections are independent: writers to
// different sections never conflict.
func (r *SectionRepository) UpdateContent(ctx context.Context, documentID, sectionID string, content map[string]any, expectedRevision int) (*Section, error) {
	const q = `UPDATE type::record($table, $id) SET content = $content, revision = revision + 1, updated_at = $updated_at WHERE document_id = $document_id AND revision = $expected_revision`
	res, err := surrealdb.Query[[]Section](ctx, r.db, q, map[string]any{
		"table": sectionTable, "id": sectionID, "content": content,
		"updated_at": time.Now(), "document_id": documentID, "expected_revision": expectedRevision,
	})
	if err != nil {
		return nil, fmt.Errorf("update section: %w", err)
	}
	updated, err := single(res)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, ErrStaleRevision
	}
	return updated, nil
}

func (r *SectionRepository) Remove(ctx context.Context, documentID, sectionID string) error {
	const q = `DELETE type::record($table, $id) WHERE document_id = $document_id RETURN BEFORE`
	res, err := surrealdb.Query[[]Section](ctx, r.db, q, map[string]any{
		"table": sectionTable, "id": sectionID, "document_id": documentID,
	})
	if err != nil {
		return fmt.Errorf("remove section: %w", err)
	}
	removed, err := single(res)
	if err != nil {
		return err
	}
	if removed == nil {
		return status.Errorf(codes.NotFound, "section %q not found", sectionID)
	}
	return nil
}

// Reorder assigns order_index by the position of each id in sectionIDs.
func (r *SectionRepository) Reorder(ctx context.Context, documentID string, sectionIDs []string) ([]Section, error) {
	for i, id := range sectionIDs {
		const q = `UPDATE type::record($table, $id) SET order_index = $order_index WHERE document_id = $document_id`
		if _, err := surrealdb.Query[[]Section](ctx, r.db, q, map[string]any{
			"table": sectionTable, "id": id, "order_index": i, "document_id": documentID,
		}); err != nil {
			return nil, fmt.Errorf("reorder section %q: %w", id, err)
		}
	}
	return r.ListByDocument(ctx, documentID)
}
