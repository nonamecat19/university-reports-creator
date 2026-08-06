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

const snapshotTable = "snapshot"

// Snapshot is a full copy of a document's state (FR-DAT-04): storage-hungry
// but restore-safe, bounded by the FR-EDT-10 caps.
type Snapshot struct {
	ID         string          `json:"-"`
	RawID      models.RecordID `json:"id"`
	DocumentID string          `json:"document_id"`
	Name       string          `json:"name"`
	// manual | export | bulk_accept | auto
	Trigger   string         `json:"trigger"`
	Data      map[string]any `json:"data"`
	CreatedAt time.Time      `json:"created_at"`
}

func (s *Snapshot) hydrateID() { s.ID = idString(s.RawID) }

type SnapshotRepository struct {
	db *surrealdb.DB
}

func NewSnapshotRepository(db *surrealdb.DB) *SnapshotRepository {
	return &SnapshotRepository{db: db}
}

func (r *SnapshotRepository) Create(ctx context.Context, documentID, name, trigger string, data map[string]any) (*Snapshot, error) {
	id := uuid.New().String()

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, name: $name, trigger: $trigger, data: $data, created_at: $created_at
	}`
	res, err := surrealdb.Query[[]Snapshot](ctx, r.db, q, map[string]any{
		"table": snapshotTable, "id": id, "document_id": documentID, "name": name,
		"trigger": trigger, "data": data, "created_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("create snapshot: %w", err)
	}
	snapshot, err := single(res)
	if err != nil {
		return nil, err
	}
	if snapshot == nil {
		return nil, status.Error(codes.Internal, "create snapshot: no row returned")
	}
	return snapshot, nil
}

// ListByDocument returns snapshots newest-first, without their payloads —
// the browser list only needs names/triggers/timestamps, and `data` holds a
// whole document each.
func (r *SnapshotRepository) ListByDocument(ctx context.Context, documentID string) ([]Snapshot, error) {
	const q = `SELECT id, document_id, name, trigger, created_at FROM snapshot
		WHERE document_id = $document_id ORDER BY created_at DESC`
	res, err := surrealdb.Query[[]Snapshot](ctx, r.db, q, map[string]any{"document_id": documentID})
	if err != nil {
		return nil, fmt.Errorf("list snapshots: %w", err)
	}
	return rows(res)
}

func (r *SnapshotRepository) GetByID(ctx context.Context, documentID, id string) (*Snapshot, error) {
	const q = `SELECT * FROM type::record($table, $id) WHERE document_id = $document_id`
	res, err := surrealdb.Query[[]Snapshot](ctx, r.db, q, map[string]any{
		"table": snapshotTable, "id": id, "document_id": documentID,
	})
	if err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	return single(res)
}

func (r *SnapshotRepository) DeleteByDocument(ctx context.Context, documentID string) error {
	const q = `DELETE snapshot WHERE document_id = $document_id`
	if _, err := surrealdb.Query[[]Snapshot](ctx, r.db, q, map[string]any{"document_id": documentID}); err != nil {
		return fmt.Errorf("delete snapshots of document: %w", err)
	}
	return nil
}

func (r *SnapshotRepository) Delete(ctx context.Context, documentID, id string) error {
	const q = `DELETE type::record($table, $id) WHERE document_id = $document_id`
	if _, err := surrealdb.Query[[]Snapshot](ctx, r.db, q, map[string]any{
		"table": snapshotTable, "id": id, "document_id": documentID,
	}); err != nil {
		return fmt.Errorf("delete snapshot: %w", err)
	}
	return nil
}
