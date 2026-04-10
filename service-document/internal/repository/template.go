package repository

import (
	"context"
	"fmt"

	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

const templateTable = "template"

type Template struct {
	ID      *models.RecordID `json:"id,omitempty"`
	Name    string           `json:"name"`
	Content string           `json:"content"`
}

type TemplateRepository struct {
	db *surrealdb.DB
}

func NewTemplateRepository(db *surrealdb.DB) *TemplateRepository {
	return &TemplateRepository{db: db}
}

func (r *TemplateRepository) Create(ctx context.Context, name, content string) (*Template, error) {
	data := map[string]any{
		"name":    name,
		"content": content,
	}

	result, err := surrealdb.Create[Template](ctx, r.db, models.Table(templateTable), data)
	if err != nil {
		return nil, fmt.Errorf("create template: %w", err)
	}

	return result, nil
}

func (r *TemplateRepository) GetByID(ctx context.Context, id string) (*Template, error) {
	result, err := surrealdb.Select[Template](ctx, r.db, models.NewRecordID(templateTable, id))
	if err != nil {
		return nil, fmt.Errorf("get template: %w", err)
	}

	return result, nil
}

func (r *TemplateRepository) List(ctx context.Context) ([]Template, error) {
	result, err := surrealdb.Select[[]Template](ctx, r.db, models.Table(templateTable))
	if err != nil {
		return nil, fmt.Errorf("list templates: %w", err)
	}

	return *result, nil
}

func (r *TemplateRepository) Update(ctx context.Context, id, name, content string) (*Template, error) {
	data := map[string]any{
		"name":    name,
		"content": content,
	}

	result, err := surrealdb.Update[Template](ctx, r.db, models.NewRecordID(templateTable, id), data)
	if err != nil {
		return nil, fmt.Errorf("update template: %w", err)
	}

	return result, nil
}

func (r *TemplateRepository) Delete(ctx context.Context, id string) error {
	_, err := surrealdb.Delete[Template](ctx, r.db, models.NewRecordID(templateTable, id))
	if err != nil {
		return fmt.Errorf("delete template: %w", err)
	}

	return nil
}
