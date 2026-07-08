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

const (
	templateTable        = "template"
	templateVersionTable = "template_version"
)

type Template struct {
	// ID is derived from RawID after decode (see idHydrator) — the driver's
	// CBOR decoder only writes record-id tags into a models.RecordID field.
	ID             string          `json:"-"`
	RawID          models.RecordID `json:"id"`
	OwnerID        string          `json:"owner_id"`
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	ReportType     string          `json:"report_type"`
	Visibility     string          `json:"visibility"`
	CurrentVersion int             `json:"current_version"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

func (t *Template) hydrateID() { t.ID = idString(t.RawID) }

type TemplateVersion struct {
	ID         string          `json:"-"`
	RawID      models.RecordID `json:"id"`
	TemplateID string          `json:"template_id"`
	Version    int             `json:"version"`
	FileKey    string          `json:"file_key"`
	// Model is a generic value, not json.RawMessage: the driver encodes/decodes
	// via CBOR, not encoding/json (see Section.Content for the same reasoning).
	Model     map[string]any `json:"model"`
	Warnings  []string       `json:"warnings"`
	Confirmed bool           `json:"confirmed"`
	CreatedAt time.Time      `json:"created_at"`
}

func (v *TemplateVersion) hydrateID() { v.ID = idString(v.RawID) }

type TemplateRepository struct {
	db *surrealdb.DB
}

func NewTemplateRepository(db *surrealdb.DB) *TemplateRepository {
	return &TemplateRepository{db: db}
}

// Create records the template plus its version 1 (unparsed until service-render
// lands in P2 — model is empty, confirmed is false).
func (r *TemplateRepository) Create(ctx context.Context, ownerID, name, description, reportType, fileRef string) (*Template, *TemplateVersion, error) {
	id := uuid.New().String()
	now := time.Now()

	const tq = `CREATE type::record($table, $id) CONTENT {
		owner_id: $owner_id, name: $name, description: $description, report_type: $report_type,
		visibility: 'private', current_version: 1, created_at: $created_at, updated_at: $updated_at
	}`
	tres, err := surrealdb.Query[[]Template](ctx, r.db, tq, map[string]any{
		"table": templateTable, "id": id, "owner_id": ownerID, "name": name,
		"description": description, "report_type": reportType, "created_at": now, "updated_at": now,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("create template: %w", err)
	}
	tmpl, err := single(tres)
	if err != nil {
		return nil, nil, err
	}
	if tmpl == nil {
		return nil, nil, status.Error(codes.Internal, "create template: no row returned")
	}

	version, err := r.createVersion(ctx, id, 1, fileRef, now)
	if err != nil {
		return nil, nil, err
	}
	return tmpl, version, nil
}

func (r *TemplateRepository) createVersion(ctx context.Context, templateID string, version int, fileRef string, now time.Time) (*TemplateVersion, error) {
	vid := uuid.New().String()
	const vq = `CREATE type::record($table, $id) CONTENT {
		template_id: $template_id, version: $version, file_key: $file_key, model: {},
		warnings: [], confirmed: false, created_at: $created_at
	}`
	vres, err := surrealdb.Query[[]TemplateVersion](ctx, r.db, vq, map[string]any{
		"table": templateVersionTable, "id": vid, "template_id": templateID,
		"version": version, "file_key": fileRef, "created_at": now,
	})
	if err != nil {
		return nil, fmt.Errorf("create template version: %w", err)
	}
	v, err := single(vres)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, status.Error(codes.Internal, "create template version: no row returned")
	}
	return v, nil
}

func (r *TemplateRepository) GetByID(ctx context.Context, id string) (*Template, error) {
	const q = `SELECT * FROM type::record($table, $id)`
	res, err := surrealdb.Query[[]Template](ctx, r.db, q, map[string]any{"table": templateTable, "id": id})
	if err != nil {
		return nil, fmt.Errorf("get template: %w", err)
	}
	return single(res)
}

func (r *TemplateRepository) CurrentVersion(ctx context.Context, templateID string, version int) (*TemplateVersion, error) {
	const q = `SELECT * FROM template_version WHERE template_id = $template_id AND version = $version LIMIT 1`
	res, err := surrealdb.Query[[]TemplateVersion](ctx, r.db, q, map[string]any{"template_id": templateID, "version": version})
	if err != nil {
		return nil, fmt.Errorf("get template version: %w", err)
	}
	return single(res)
}

// List filters by owner (own) or public visibility, optional report type and
// name substring, with pagination.
func (r *TemplateRepository) List(ctx context.Context, ownerID string, own bool, reportType, query string, pageSize int, pageToken string) ([]Template, string, int, error) {
	offset := decodePageToken(pageToken)
	if pageSize <= 0 {
		pageSize = 20
	}

	cond := "visibility = 'public'"
	vars := map[string]any{"limit": pageSize, "offset": offset}
	if own {
		cond = "owner_id = $owner_id"
		vars["owner_id"] = ownerID
	}
	if reportType != "" {
		cond += " AND report_type = $report_type"
		vars["report_type"] = reportType
	}
	if query != "" {
		cond += " AND name ~ $query"
		vars["query"] = query
	}

	selectQ := fmt.Sprintf(`SELECT * FROM template WHERE %s ORDER BY updated_at DESC LIMIT $limit START $offset`, cond)
	selectRes, err := surrealdb.Query[[]Template](ctx, r.db, selectQ, vars)
	if err != nil {
		return nil, "", 0, fmt.Errorf("list templates: %w", err)
	}
	templates, err := rows(selectRes)
	if err != nil {
		return nil, "", 0, fmt.Errorf("list templates: %w", err)
	}

	countQ := fmt.Sprintf(`SELECT count() FROM template WHERE %s GROUP ALL`, cond)
	countRes, err := surrealdb.Query[[]countRow](ctx, r.db, countQ, vars)
	if err != nil {
		return nil, "", 0, fmt.Errorf("count templates: %w", err)
	}
	total := countFrom(countRes)

	next := ""
	if offset+len(templates) < total {
		next = encodePageToken(offset + len(templates))
	}
	return templates, next, total, nil
}

func (r *TemplateRepository) UpdateMeta(ctx context.Context, id, ownerID, name, description, visibility string) (*Template, error) {
	const q = `UPDATE type::record($table, $id) SET name = $name, description = $description, visibility = $visibility, updated_at = $updated_at WHERE owner_id = $owner_id`
	res, err := surrealdb.Query[[]Template](ctx, r.db, q, map[string]any{
		"table": templateTable, "id": id, "name": name, "description": description,
		"visibility": visibility, "updated_at": time.Now(), "owner_id": ownerID,
	})
	if err != nil {
		return nil, fmt.Errorf("update template meta: %w", err)
	}
	tmpl, err := single(res)
	if err != nil {
		return nil, err
	}
	if tmpl == nil {
		return nil, status.Errorf(codes.NotFound, "template %q not found", id)
	}
	return tmpl, nil
}

func (r *TemplateRepository) UploadVersion(ctx context.Context, id, ownerID, fileRef string) (*Template, *TemplateVersion, error) {
	tmpl, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if tmpl == nil || tmpl.OwnerID != ownerID {
		return nil, nil, status.Errorf(codes.NotFound, "template %q not found", id)
	}

	nextVersion := tmpl.CurrentVersion + 1
	version, err := r.createVersion(ctx, id, nextVersion, fileRef, time.Now())
	if err != nil {
		return nil, nil, err
	}

	const q = `UPDATE type::record($table, $id) SET current_version = $version, updated_at = $updated_at WHERE owner_id = $owner_id`
	res, err := surrealdb.Query[[]Template](ctx, r.db, q, map[string]any{
		"table": templateTable, "id": id, "version": nextVersion, "updated_at": time.Now(), "owner_id": ownerID,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("bump template version: %w", err)
	}
	updated, err := single(res)
	if err != nil {
		return nil, nil, err
	}
	return updated, version, nil
}

// SetParsedModel stores the auto-parsed TemplateModel (FR-TPL-08) right after
// upload, before the user has reviewed/confirmed it (FR-TPL-11) — Confirmed
// stays false until ConfirmTemplate.
func (r *TemplateRepository) SetParsedModel(ctx context.Context, templateID string, version int, model map[string]any, warnings []string) (*TemplateVersion, error) {
	const q = `UPDATE template_version SET model = $model, warnings = $warnings WHERE template_id = $template_id AND version = $version`
	res, err := surrealdb.Query[[]TemplateVersion](ctx, r.db, q, map[string]any{
		"template_id": templateID, "version": version, "model": model, "warnings": warnings,
	})
	if err != nil {
		return nil, fmt.Errorf("set parsed template model: %w", err)
	}
	v, err := single(res)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, status.Errorf(codes.NotFound, "template version not found")
	}
	return v, nil
}

// Confirm marks the current version's reviewed/adjusted model as confirmed
// (FR-TPL-11).
func (r *TemplateRepository) Confirm(ctx context.Context, templateID string, version int, adjustedModel map[string]any) (*TemplateVersion, error) {
	const q = `UPDATE template_version SET model = $model, confirmed = true WHERE template_id = $template_id AND version = $version`
	res, err := surrealdb.Query[[]TemplateVersion](ctx, r.db, q, map[string]any{
		"template_id": templateID, "version": version, "model": adjustedModel,
	})
	if err != nil {
		return nil, fmt.Errorf("confirm template: %w", err)
	}
	v, err := single(res)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, status.Errorf(codes.NotFound, "template version not found")
	}
	return v, nil
}

// DeleteIfUnreferenced deletes the template unless a document references it,
// per FR-API-06 (soft-hide is a P-later refinement; P1 just blocks deletion).
func (r *TemplateRepository) DeleteIfUnreferenced(ctx context.Context, id, ownerID string) error {
	const countQ = `SELECT count() FROM document WHERE template_id = $template_id GROUP ALL`
	countRes, err := surrealdb.Query[[]countRow](ctx, r.db, countQ, map[string]any{"template_id": id})
	if err != nil {
		return fmt.Errorf("count referencing documents: %w", err)
	}
	if countFrom(countRes) > 0 {
		return status.Error(codes.FailedPrecondition, "template is referenced by existing documents")
	}

	const delVersionsQ = `DELETE template_version WHERE template_id = $template_id`
	if _, err := surrealdb.Query[[]TemplateVersion](ctx, r.db, delVersionsQ, map[string]any{"template_id": id}); err != nil {
		return fmt.Errorf("delete template versions: %w", err)
	}

	const delQ = `DELETE type::record($table, $id) WHERE owner_id = $owner_id RETURN BEFORE`
	res, err := surrealdb.Query[[]Template](ctx, r.db, delQ, map[string]any{
		"table": templateTable, "id": id, "owner_id": ownerID,
	})
	if err != nil {
		return fmt.Errorf("delete template: %w", err)
	}
	deleted, err := single(res)
	if err != nil {
		return err
	}
	if deleted == nil {
		return status.Errorf(codes.NotFound, "template %q not found", id)
	}
	return nil
}
