package repository

import surrealdb "github.com/surrealdb/surrealdb.go"

type Repos struct {
	Document   *DocumentRepository
	Section    *SectionRepository
	Template   *TemplateRepository
	ExportJob  *ExportJobRepository
	Source     *SourceRepository
	Snapshot   *SnapshotRepository
	Share      *ShareRepository
	Comment    *CommentRepository
	Suggestion *SuggestionRepository
	ReadCursor *ReadCursorRepository
}

func New(db *surrealdb.DB) *Repos {
	return &Repos{
		Document:   NewDocumentRepository(db),
		Section:    NewSectionRepository(db),
		Template:   NewTemplateRepository(db),
		ExportJob:  NewExportJobRepository(db),
		Source:     NewSourceRepository(db),
		Snapshot:   NewSnapshotRepository(db),
		Share:      NewShareRepository(db),
		Comment:    NewCommentRepository(db),
		Suggestion: NewSuggestionRepository(db),
		ReadCursor: NewReadCursorRepository(db),
	}
}
