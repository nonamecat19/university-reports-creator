package repository

import surrealdb "github.com/surrealdb/surrealdb.go"

type Repos struct {
	Document *DocumentRepository
	Template *TemplateRepository
}

func New(db *surrealdb.DB) *Repos {
	return &Repos{
		Document: NewDocumentRepository(db),
		Template: NewTemplateRepository(db),
	}
}
