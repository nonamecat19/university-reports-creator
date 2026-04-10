package repository

import (
	"context"
	"fmt"

	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

const tableName = "document"

type Document struct {
	ID      *models.RecordID `json:"id,omitempty"`
	Name    string           `json:"name"`
	Content string           `json:"content"`
}

type DocumentRepository struct {
	db *surrealdb.DB
}

func NewDocumentRepository(db *surrealdb.DB) *DocumentRepository {
	return &DocumentRepository{db: db}
}

func (r *DocumentRepository) Create(ctx context.Context, name, content string) (*Document, error) {
	data := map[string]any{
		"name":    name,
		"content": content,
	}

	result, err := surrealdb.Create[Document](ctx, r.db, models.Table(tableName), data)
	if err != nil {
		return nil, fmt.Errorf("create document: %w", err)
	}

	return result, nil
}

func (r *DocumentRepository) GetByID(ctx context.Context, id string) (*Document, error) {
	result, err := surrealdb.Select[Document](ctx, r.db, models.NewRecordID(tableName, id))
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}

	return result, nil
}

func (r *DocumentRepository) List(ctx context.Context) ([]Document, error) {
	result, err := surrealdb.Select[[]Document](ctx, r.db, models.Table(tableName))
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}

	return *result, nil
}

func (r *DocumentRepository) Update(ctx context.Context, id, name, content string) (*Document, error) {
	data := map[string]any{
		"name":    name,
		"content": content,
	}

	result, err := surrealdb.Update[Document](ctx, r.db, models.NewRecordID(tableName, id), data)
	if err != nil {
		return nil, fmt.Errorf("update document: %w", err)
	}

	return result, nil
}

func (r *DocumentRepository) Delete(ctx context.Context, id string) error {
	_, err := surrealdb.Delete[Document](ctx, r.db, models.NewRecordID(tableName, id))
	if err != nil {
		return fmt.Errorf("delete document: %w", err)
	}

	return nil
}
