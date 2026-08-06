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

const sourceTable = "source"

// Source is one bibliography entry (FR-BIB-02). CSL is the citeproc input
// document, stored as a generic map because the driver round-trips through
// CBOR, not encoding/json — a json.RawMessage would come back as an opaque
// byte string instead of the FLEXIBLE object it is.
type Source struct {
	ID                     string          `json:"-"`
	RawID                  models.RecordID `json:"id"`
	DocumentID             string          `json:"document_id"`
	CSL                    map[string]any  `json:"csl"`
	Language               string          `json:"language"`
	RawInput               string          `json:"raw_input"`
	FillStatus             string          `json:"fill_status"`
	AccessDate             string          `json:"access_date"`
	IncludeUncitedOverride bool            `json:"include_uncited_override"`
	CreatedAt              time.Time       `json:"created_at"`
}

func (s *Source) hydrateID() { s.ID = idString(s.RawID) }

type SourceRepository struct {
	db *surrealdb.DB
}

func NewSourceRepository(db *surrealdb.DB) *SourceRepository {
	return &SourceRepository{db: db}
}

func (r *SourceRepository) ListByDocument(ctx context.Context, documentID string) ([]Source, error) {
	const q = `SELECT * FROM source WHERE document_id = $document_id ORDER BY created_at ASC`
	res, err := surrealdb.Query[[]Source](ctx, r.db, q, map[string]any{"document_id": documentID})
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	return rows(res)
}

func (r *SourceRepository) Add(ctx context.Context, documentID string, csl map[string]any, language, rawInput, fillStatus, accessDate string) (*Source, error) {
	id := uuid.New().String()
	if csl == nil {
		csl = map[string]any{}
	}
	// The CSL `id` is what citation nodes and the rendered list key on, so it
	// is always the record id — never whatever the resolver put there.
	csl["id"] = id

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, csl: $csl, language: $language, raw_input: $raw_input,
		fill_status: $fill_status, access_date: $access_date, include_uncited_override: false,
		created_at: $created_at
	}`
	res, err := surrealdb.Query[[]Source](ctx, r.db, q, map[string]any{
		"table": sourceTable, "id": id, "document_id": documentID, "csl": csl,
		"language": language, "raw_input": rawInput, "fill_status": fillStatus,
		"access_date": accessDate, "created_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("add source: %w", err)
	}
	source, err := single(res)
	if err != nil {
		return nil, err
	}
	if source == nil {
		return nil, status.Error(codes.Internal, "add source: no row returned")
	}
	return source, nil
}

func (r *SourceRepository) Update(ctx context.Context, documentID, sourceID string, csl map[string]any, language, fillStatus, accessDate string, includeUncited bool) (*Source, error) {
	if csl == nil {
		csl = map[string]any{}
	}
	csl["id"] = sourceID

	const q = `UPDATE type::record($table, $id) SET csl = $csl, language = $language,
		fill_status = $fill_status, access_date = $access_date,
		include_uncited_override = $include_uncited
		WHERE document_id = $document_id`
	res, err := surrealdb.Query[[]Source](ctx, r.db, q, map[string]any{
		"table": sourceTable, "id": sourceID, "csl": csl, "language": language,
		"fill_status": fillStatus, "access_date": accessDate,
		"include_uncited": includeUncited, "document_id": documentID,
	})
	if err != nil {
		return nil, fmt.Errorf("update source: %w", err)
	}
	updated, err := single(res)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, status.Errorf(codes.NotFound, "source %q not found", sourceID)
	}
	return updated, nil
}

func (r *SourceRepository) Delete(ctx context.Context, documentID, sourceID string) error {
	const q = `DELETE type::record($table, $id) WHERE document_id = $document_id RETURN BEFORE`
	res, err := surrealdb.Query[[]Source](ctx, r.db, q, map[string]any{
		"table": sourceTable, "id": sourceID, "document_id": documentID,
	})
	if err != nil {
		return fmt.Errorf("delete source: %w", err)
	}
	removed, err := single(res)
	if err != nil {
		return err
	}
	if removed == nil {
		return status.Errorf(codes.NotFound, "source %q not found", sourceID)
	}
	return nil
}

// DeleteByDocument cascades sources when their document goes away (FR-DAT-01).
func (r *SourceRepository) DeleteByDocument(ctx context.Context, documentID string) error {
	const q = `DELETE source WHERE document_id = $document_id`
	if _, err := surrealdb.Query[[]Source](ctx, r.db, q, map[string]any{"document_id": documentID}); err != nil {
		return fmt.Errorf("delete sources of document: %w", err)
	}
	return nil
}

// RestoreFromSnapshot recreates a source with its original id so citation
// nodes that reference it keep resolving after a restore (FR-EDT-10).
func (r *SourceRepository) RestoreFromSnapshot(
	ctx context.Context,
	documentID, id string,
	csl map[string]any,
	language, rawInput, fillStatus, accessDate string,
	includeUncited bool,
) (*Source, error) {
	if csl == nil {
		csl = map[string]any{}
	}
	csl["id"] = id

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, csl: $csl, language: $language, raw_input: $raw_input,
		fill_status: $fill_status, access_date: $access_date,
		include_uncited_override: $include_uncited, created_at: $created_at
	}`
	res, err := surrealdb.Query[[]Source](ctx, r.db, q, map[string]any{
		"table": sourceTable, "id": id, "document_id": documentID, "csl": csl,
		"language": language, "raw_input": rawInput, "fill_status": fillStatus,
		"access_date": accessDate, "include_uncited": includeUncited, "created_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("restore source: %w", err)
	}
	return single(res)
}
