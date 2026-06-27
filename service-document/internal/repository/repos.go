package repository

import surrealdb "github.com/surrealdb/surrealdb.go"

type Repos struct {
	Document *DocumentRepository
	Section  *SectionRepository
	Template *TemplateRepository
}

func New(db *surrealdb.DB) *Repos {
	return &Repos{
		Document: NewDocumentRepository(db),
		Section:  NewSectionRepository(db),
		Template: NewTemplateRepository(db),
	}
}
