package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

const exportJobTable = "export_job"

type ExportArtifact struct {
	Kind     string `json:"kind"`
	FileKey  string `json:"file_key"`
	Filename string `json:"filename"`
}

type ExportJob struct {
	ID          string           `json:"-"`
	RawID       models.RecordID  `json:"id"`
	DocumentID  string           `json:"document_id"`
	RequestedBy string           `json:"requested_by"`
	Options     map[string]any   `json:"options"`
	Status      string           `json:"status"`
	Stage       string           `json:"stage"`
	Warnings    []string         `json:"warnings"`
	Artifacts   []ExportArtifact `json:"artifacts"`
	Error       string           `json:"error"`
	CreatedAt   time.Time        `json:"created_at"`
	FinishedAt  *time.Time       `json:"finished_at"`
}

func (j *ExportJob) hydrateID() { j.ID = idString(j.RawID) }

type ExportJobRepository struct {
	db *surrealdb.DB
}

func NewExportJobRepository(db *surrealdb.DB) *ExportJobRepository {
	return &ExportJobRepository{db: db}
}

// Create records a running export job. There is no async queue yet (P2 MVP):
// the caller runs the pipeline synchronously and calls Complete/Fail right
// after, but the job record still exists for GetExportJob/ListExports polling
// per the FR-API-11a contract.
func (r *ExportJobRepository) Create(ctx context.Context, documentID, requestedBy string, options map[string]any) (*ExportJob, error) {
	id := uuid.New().String()
	now := time.Now()

	const q = `CREATE type::record($table, $id) CONTENT {
		document_id: $document_id, requested_by: $requested_by, options: $options,
		status: 'running', stage: 'starting', warnings: [], artifacts: [], error: '', created_at: $created_at
	}`
	res, err := surrealdb.Query[[]ExportJob](ctx, r.db, q, map[string]any{
		"table": exportJobTable, "id": id, "document_id": documentID,
		"requested_by": requestedBy, "options": options, "created_at": now,
	})
	if err != nil {
		return nil, fmt.Errorf("create export job: %w", err)
	}
	job, err := single(res)
	if err != nil {
		return nil, err
	}
	return job, nil
}

func (r *ExportJobRepository) Complete(ctx context.Context, id string, artifacts []ExportArtifact, warnings []string) (*ExportJob, error) {
	const q = `UPDATE type::record($table, $id) SET status = 'done', stage = 'done', artifacts = $artifacts, warnings = $warnings, finished_at = $finished_at`
	res, err := surrealdb.Query[[]ExportJob](ctx, r.db, q, map[string]any{
		"table": exportJobTable, "id": id, "artifacts": artifacts, "warnings": warnings, "finished_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("complete export job: %w", err)
	}
	return single(res)
}

func (r *ExportJobRepository) Fail(ctx context.Context, id string, errMsg string) (*ExportJob, error) {
	const q = `UPDATE type::record($table, $id) SET status = 'failed', stage = 'failed', error = $error, finished_at = $finished_at`
	res, err := surrealdb.Query[[]ExportJob](ctx, r.db, q, map[string]any{
		"table": exportJobTable, "id": id, "error": errMsg, "finished_at": time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("fail export job: %w", err)
	}
	return single(res)
}

func (r *ExportJobRepository) GetByID(ctx context.Context, id string) (*ExportJob, error) {
	const q = `SELECT * FROM type::record($table, $id)`
	res, err := surrealdb.Query[[]ExportJob](ctx, r.db, q, map[string]any{"table": exportJobTable, "id": id})
	if err != nil {
		return nil, fmt.Errorf("get export job: %w", err)
	}
	return single(res)
}

func (r *ExportJobRepository) ListByDocument(ctx context.Context, documentID string) ([]ExportJob, error) {
	const q = `SELECT * FROM export_job WHERE document_id = $document_id ORDER BY created_at DESC LIMIT 10`
	res, err := surrealdb.Query[[]ExportJob](ctx, r.db, q, map[string]any{"document_id": documentID})
	if err != nil {
		return nil, fmt.Errorf("list export jobs: %w", err)
	}
	return rows(res)
}
