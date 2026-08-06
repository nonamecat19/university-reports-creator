package repository

import surrealdb "github.com/surrealdb/surrealdb.go"

type Repos struct {
	Document  *DocumentRepository
	Section   *SectionRepository
	Template  *TemplateRepository
	ExportJob *ExportJobRepository
	Source    *SourceRepository
	Snapshot  *SnapshotRepository
}

func New(db *surrealdb.DB) *Repos {
	return &Repos{
		Document:  NewDocumentRepository(db),
		Section:   NewSectionRepository(db),
		Template:  NewTemplateRepository(db),
		ExportJob: NewExportJobRepository(db),
		Source:    NewSourceRepository(db),
		Snapshot:  NewSnapshotRepository(db),
	}
}
