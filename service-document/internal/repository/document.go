package repository

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const documentTable = "document"

// ErrStaleRevision signals an optimistic-concurrency conflict (FR-DAT-02):
// the caller's revision no longer matches the stored one.
var ErrStaleRevision = errors.New("stale revision")

type Settings struct {
	CitationStyle     string `json:"citation_style"`
	NumberingMode     string `json:"numbering_mode"`
	IncludeUncited    bool   `json:"include_uncited"`
	TableContinuation string `json:"table_continuation"`
}

type Document struct {
	// ID is derived from RawID after decode (see idHydrator) — the driver's
	// CBOR decoder only writes record-id tags into a models.RecordID field.
	ID               string            `json:"-"`
	RawID            models.RecordID   `json:"id"`
	OwnerID          string            `json:"owner_id"`
	TemplateID       string            `json:"template_id"`
	TemplateVersion  int               `json:"template_version"`
	Title            string            `json:"title"`
	Metadata         map[string]string `json:"metadata"`
	Settings         Settings          `json:"settings"`
	MetadataRevision int               `json:"metadata_revision"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

func (d *Document) hydrateID() { d.ID = idString(d.RawID) }

type DocumentRepository struct {
	db *surrealdb.DB
}

func NewDocumentRepository(db *surrealdb.DB) *DocumentRepository {
	return &DocumentRepository{db: db}
}

func (r *DocumentRepository) Create(ctx context.Context, ownerID, templateID string, templateVersion int, title string, initialMetadata map[string]string) (*Document, error) {
	now := time.Now()
	id := uuid.New().String()
	if initialMetadata == nil {
		initialMetadata = map[string]string{}
	}

	const q = `CREATE type::record($table, $id) CONTENT {
		owner_id: $owner_id, template_id: $template_id, template_version: $template_version,
		title: $title, metadata: $metadata, settings: $settings, metadata_revision: 0,
		created_at: $created_at, updated_at: $updated_at
	}`
	res, err := surrealdb.Query[[]Document](ctx, r.db, q, map[string]any{
		"table":            documentTable,
		"id":               id,
		"owner_id":         ownerID,
		"template_id":      templateID,
		"template_version": templateVersion,
		"title":            title,
		"metadata":         initialMetadata,
		"settings":         Settings{NumberingMode: "by_order", TableContinuation: "repeat_header"},
		"created_at":       now,
		"updated_at":       now,
	})
	if err != nil {
		return nil, fmt.Errorf("create document: %w", err)
	}
	doc, err := single(res)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, status.Error(codes.Internal, "create document: no row returned")
	}
	return doc, nil
}

func (r *DocumentRepository) GetByID(ctx context.Context, id string) (*Document, error) {
	const q = `SELECT * FROM type::record($table, $id)`
	res, err := surrealdb.Query[[]Document](ctx, r.db, q, map[string]any{"table": documentTable, "id": id})
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}
	return single(res)
}

// GetOwned returns the document only if owned by ownerID (P1 ownership
// enforcement; roles/sharing land in P4).
func (r *DocumentRepository) GetOwned(ctx context.Context, id, ownerID string) (*Document, error) {
	doc, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if doc == nil || doc.OwnerID != ownerID {
		return nil, status.Errorf(codes.NotFound, "document %q not found", id)
	}
	return doc, nil
}

// List returns owned documents ordered by most-recently-updated, the total
// count, and a page token for the next page (empty when exhausted).
func (r *DocumentRepository) List(ctx context.Context, ownerID string, pageSize int, pageToken string) ([]Document, string, int, error) {
	offset := decodePageToken(pageToken)
	if pageSize <= 0 {
		pageSize = 20
	}

	const selectQ = `SELECT * FROM document WHERE owner_id = $owner_id ORDER BY updated_at DESC LIMIT $limit START $offset`
	selectRes, err := surrealdb.Query[[]Document](ctx, r.db, selectQ, map[string]any{
		"owner_id": ownerID, "limit": pageSize, "offset": offset,
	})
	if err != nil {
		return nil, "", 0, fmt.Errorf("list documents: %w", err)
	}
	docs, err := rows(selectRes)
	if err != nil {
		return nil, "", 0, fmt.Errorf("list documents: %w", err)
	}

	const countQ = `SELECT count() FROM document WHERE owner_id = $owner_id GROUP ALL`
	countRes, err := surrealdb.Query[[]countRow](ctx, r.db, countQ, map[string]any{"owner_id": ownerID})
	if err != nil {
		return nil, "", 0, fmt.Errorf("count documents: %w", err)
	}
	total := countFrom(countRes)

	next := ""
	if offset+len(docs) < total {
		next = encodePageToken(offset + len(docs))
	}
	return docs, next, total, nil
}

func (r *DocumentRepository) Rename(ctx context.Context, id, ownerID, title string) (*Document, error) {
	const q = `UPDATE type::record($table, $id) SET title = $title, updated_at = $updated_at WHERE owner_id = $owner_id`
	res, err := surrealdb.Query[[]Document](ctx, r.db, q, map[string]any{
		"table": documentTable, "id": id, "title": title, "updated_at": time.Now(), "owner_id": ownerID,
	})
	if err != nil {
		return nil, fmt.Errorf("rename document: %w", err)
	}
	doc, err := single(res)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, status.Errorf(codes.NotFound, "document %q not found", id)
	}
	return doc, nil
}

// UpdateMetadata merges values on top of existing metadata, bumping
// metadata_revision, rejecting a stale expectedRevision (FR-DAT-02/FR-EDT-09).
func (r *DocumentRepository) UpdateMetadata(ctx context.Context, id, ownerID string, values map[string]string, expectedRevision int) (*Document, error) {
	doc, err := r.GetOwned(ctx, id, ownerID)
	if err != nil {
		return nil, err
	}
	if doc.MetadataRevision != expectedRevision {
		return nil, ErrStaleRevision
	}
	merged := doc.Metadata
	if merged == nil {
		merged = map[string]string{}
	}
	for k, v := range values {
		merged[k] = v
	}

	const q = `UPDATE type::record($table, $id) SET metadata = $metadata, metadata_revision = $next_revision, updated_at = $updated_at WHERE owner_id = $owner_id AND metadata_revision = $expected_revision`
	res, err := surrealdb.Query[[]Document](ctx, r.db, q, map[string]any{
		"table": documentTable, "id": id, "metadata": merged,
		"next_revision": doc.MetadataRevision + 1, "updated_at": time.Now(),
		"owner_id": ownerID, "expected_revision": expectedRevision,
	})
	if err != nil {
		return nil, fmt.Errorf("update metadata: %w", err)
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

func (r *DocumentRepository) UpdateSettings(ctx context.Context, id, ownerID string, settings Settings, expectedRevision int) (*Document, error) {
	const q = `UPDATE type::record($table, $id) SET settings = $settings, metadata_revision = metadata_revision + 1, updated_at = $updated_at WHERE owner_id = $owner_id AND metadata_revision = $expected_revision`
	res, err := surrealdb.Query[[]Document](ctx, r.db, q, map[string]any{
		"table": documentTable, "id": id, "settings": settings,
		"updated_at": time.Now(), "owner_id": ownerID, "expected_revision": expectedRevision,
	})
	if err != nil {
		return nil, fmt.Errorf("update settings: %w", err)
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

func (r *DocumentRepository) Delete(ctx context.Context, id, ownerID string) error {
	const q = `DELETE type::record($table, $id) WHERE owner_id = $owner_id RETURN BEFORE`
	res, err := surrealdb.Query[[]Document](ctx, r.db, q, map[string]any{
		"table": documentTable, "id": id, "owner_id": ownerID,
	})
	if err != nil {
		return fmt.Errorf("delete document: %w", err)
	}
	deleted, err := single(res)
	if err != nil {
		return err
	}
	if deleted == nil {
		return status.Errorf(codes.NotFound, "document %q not found", id)
	}
	return nil
}

func encodePageToken(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodePageToken(token string) int {
	if token == "" {
		return 0
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(string(raw))
	if err != nil || n < 0 {
		return 0
	}
	return n
}
