package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/nnc/university-reports-creator/gen/go/document"
	filepb "github.com/nnc/university-reports-creator/gen/go/file"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcerr"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcmeta"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

type DocumentService struct {
	pb.UnimplementedDocumentServiceServer
	Base
}

func requireUserID(ctx context.Context) (string, error) {
	userID := grpcmeta.UserID(ctx)
	if userID == "" {
		return "", status.Error(codes.Unauthenticated, "authentication required")
	}
	return userID, nil
}

// callerName is the caller's display name, forwarded by the gateway from the
// verified access token. service-document must not call service-auth
// (FR-ARC-07), so every record that will later need to show a human author
// captures the name at write time; "" when the token carried none.
func callerName(ctx context.Context) string {
	return grpcmeta.UserName(ctx)
}

func (s *DocumentService) CreateDocument(ctx context.Context, req *pb.CreateDocumentRequest) (*pb.DocumentResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetTitle() == "" {
		return nil, grpcerr.InvalidArgument("title is required", grpcerr.FieldViolation{Field: "title", Description: "must not be empty"})
	}

	var model *templateModel
	if req.GetTemplateId() != "" {
		version, err := s.Repos.Template.CurrentVersion(ctx, req.GetTemplateId(), int(req.GetTemplateVersion()))
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to load template version: %v", err)
		}
		if version == nil {
			return nil, status.Errorf(codes.NotFound, "template version not found")
		}
		if !version.Confirmed {
			return nil, status.Error(codes.FailedPrecondition, "template has not been confirmed yet (FR-TPL-11)")
		}
		model, err = parseTemplateModel(version.Model)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "invalid template model: %v", err)
		}
	}

	var initialMetadata map[string]string
	if model != nil {
		initialMetadata = defaultsFromFields(model.Fields)
	}

	doc, err := s.Repos.Document.Create(ctx, ownerID, req.GetTemplateId(), int(req.GetTemplateVersion()), req.GetTitle(), initialMetadata)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create document: %v", err)
	}

	var pbSections []*pb.Section
	if model != nil {
		pbSections = make([]*pb.Section, 0, len(model.Sections))
		for _, ms := range model.Sections {
			kind := "chapter"
			if ms.Kind == "appendix" {
				kind = "appendix"
			}
			sec, err := s.Repos.Section.AddFromTemplate(ctx, doc.ID, ms.ID, ms.Label, kind, ms.Order, ms.Required, ms.ExampleContent)
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to create section %q from template: %v", ms.ID, err)
			}
			pbSections = append(pbSections, sectionToProto(sec))
		}
	}

	return &pb.DocumentResponse{Document: documentToProto(doc, pb.Role_ROLE_OWNER), Sections: pbSections}, nil
}

func (s *DocumentService) GetDocument(ctx context.Context, req *pb.GetDocumentRequest) (*pb.DocumentResponse, error) {
	doc, role, err := s.requireAccess(ctx, req.GetId(), pb.Role_ROLE_VIEWER)
	if err != nil {
		return nil, err
	}
	sections, err := s.Repos.Section.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list sections: %v", err)
	}

	pbSections := make([]*pb.Section, 0, len(sections))
	for _, sec := range sections {
		pbSections = append(pbSections, sectionToProto(&sec))
	}

	return &pb.DocumentResponse{
		Document: documentToProto(doc, role),
		Sections: pbSections,
	}, nil
}

func (s *DocumentService) ListDocuments(ctx context.Context, req *pb.ListDocumentsRequest) (*pb.ListDocumentsResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}

	if req.GetFilter() == pb.DocumentFilter_DOCUMENT_FILTER_SHARED {
		return s.listSharedDocuments(ctx, ownerID)
	}

	docs, nextToken, total, err := s.Repos.Document.List(ctx, ownerID, int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list documents: %v", err)
	}

	pbDocs := make([]*pb.Document, 0, len(docs))
	for _, d := range docs {
		pbDocs = append(pbDocs, documentToProto(&d, pb.Role_ROLE_OWNER))
	}

	return &pb.ListDocumentsResponse{
		Documents:     pbDocs,
		NextPageToken: nextToken,
		TotalCount:    int32(total),
	}, nil
}

func (s *DocumentService) RenameDocument(ctx context.Context, req *pb.RenameDocumentRequest) (*pb.DocumentResponse, error) {
	current, role, err := s.requireAccess(ctx, req.GetId(), pb.Role_ROLE_EDITOR)
	if err != nil {
		return nil, err
	}
	doc, err := s.Repos.Document.Rename(ctx, req.GetId(), current.OwnerID, req.GetTitle())
	if err != nil {
		return nil, err
	}
	return &pb.DocumentResponse{Document: documentToProto(doc, role)}, nil
}

func (s *DocumentService) UpdateMetadata(ctx context.Context, req *pb.UpdateMetadataRequest) (*pb.DocumentResponse, error) {
	current, role, err := s.requireAccess(ctx, req.GetId(), pb.Role_ROLE_EDITOR)
	if err != nil {
		return nil, err
	}
	doc, err := s.Repos.Document.UpdateMetadata(ctx, req.GetId(), current.OwnerID, req.GetValues(), int(req.GetMetadataRevision()))
	if err != nil {
		if errors.Is(err, repository.ErrStaleRevision) {
			return nil, s.staleMetadataRevisionErr(ctx, req.GetId())
		}
		return nil, err
	}
	return &pb.DocumentResponse{Document: documentToProto(doc, role)}, nil
}

func (s *DocumentService) staleMetadataRevisionErr(ctx context.Context, id string) error {
	if current, err := s.Repos.Document.GetByID(ctx, id); err == nil && current != nil {
		return grpcerr.StaleRevision("metadata_revision is stale", int32(current.MetadataRevision))
	}
	return grpcerr.StaleRevision("metadata_revision is stale", 0)
}

func (s *DocumentService) UpdateSettings(ctx context.Context, req *pb.UpdateSettingsRequest) (*pb.DocumentResponse, error) {
	// Export/citation settings are the owner's call (FR-REV-04).
	current, _, err := s.requireAccess(ctx, req.GetId(), pb.Role_ROLE_OWNER)
	if err != nil {
		return nil, err
	}
	settings := repository.Settings{}
	if reqSettings := req.GetSettings(); reqSettings != nil {
		settings = repository.Settings{
			CitationStyle:     reqSettings.GetCitationStyle(),
			NumberingMode:     reqSettings.GetNumberingMode(),
			IncludeUncited:    reqSettings.GetIncludeUncited(),
			TableContinuation: reqSettings.GetTableContinuation(),
		}
	}
	doc, err := s.Repos.Document.UpdateSettings(ctx, req.GetId(), current.OwnerID, settings, int(req.GetMetadataRevision()))
	if err != nil {
		if errors.Is(err, repository.ErrStaleRevision) {
			return nil, s.staleMetadataRevisionErr(ctx, req.GetId())
		}
		return nil, err
	}
	return &pb.DocumentResponse{Document: documentToProto(doc, pb.Role_ROLE_OWNER)}, nil
}

func (s *DocumentService) UpdateSection(ctx context.Context, req *pb.UpdateSectionRequest) (*pb.SectionResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR)
	if err != nil {
		return nil, err
	}

	raw := req.GetContentJson()
	if raw == "" {
		raw = "{}"
	}
	var content map[string]any
	if err := json.Unmarshal([]byte(raw), &content); err != nil {
		return nil, grpcerr.InvalidArgument("content_json is not valid JSON", grpcerr.FieldViolation{Field: "content_json", Description: "must be valid JSON"})
	}

	// FR-EDT-10(c): at most one automatic snapshot per hour of active editing.
	// Taken *before* the write so the snapshot is the last known-good state.
	s.maybeHourlySnapshot(ctx, doc)

	section, err := s.Repos.Section.UpdateContent(ctx, req.GetDocumentId(), req.GetSectionId(), content, int(req.GetSectionRevision()))
	if err != nil {
		if errors.Is(err, repository.ErrStaleRevision) {
			current := int32(0)
			if existing, gerr := s.Repos.Section.GetByID(ctx, req.GetDocumentId(), req.GetSectionId()); gerr == nil && existing != nil {
				current = int32(existing.Revision)
			}
			return nil, grpcerr.StaleRevision("section_revision is stale", current)
		}
		return nil, status.Errorf(codes.Internal, "failed to update section: %v", err)
	}

	// FR-REV-06: a comment whose anchor block was deleted degrades to
	// "orphaned" (listed at section level) instead of being lost, and comes
	// back if the block does.
	if err := s.Repos.Comment.SetOrphanedByBlocks(ctx, req.GetDocumentId(), req.GetSectionId(), collectBlockIDs(content)); err != nil {
		slog.WarnContext(ctx, "failed to reconcile comment anchors", "section_id", req.GetSectionId(), "error", err)
	}

	return &pb.SectionResponse{Section: sectionToProto(section)}, nil
}

// collectBlockIDs returns every stable block_id present in a ProseMirror doc
// (FR-EDT-04) — the set comment anchors are matched against, and the set a
// cross-reference is allowed to point at.
func collectBlockIDs(node map[string]any) []string {
	return collectAttr(node, "", "blockId")
}

func (s *DocumentService) AddSection(ctx context.Context, req *pb.AddSectionRequest) (*pb.SectionResponse, error) {
	if _, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR); err != nil {
		return nil, err
	}

	kind := "chapter"
	if req.GetKind() == pb.SectionKind_SECTION_KIND_APPENDIX {
		kind = "appendix"
	}

	section, err := s.Repos.Section.Add(ctx, req.GetDocumentId(), req.GetTitle(), kind, int(req.GetOrder()))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to add section: %v", err)
	}
	return &pb.SectionResponse{Section: sectionToProto(section)}, nil
}

func (s *DocumentService) RemoveSection(ctx context.Context, req *pb.RemoveSectionRequest) (*pb.RemoveSectionResponse, error) {
	if _, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR); err != nil {
		return nil, err
	}
	if err := s.Repos.Section.Remove(ctx, req.GetDocumentId(), req.GetSectionId()); err != nil {
		return nil, err
	}
	return &pb.RemoveSectionResponse{}, nil
}

func (s *DocumentService) ReorderSections(ctx context.Context, req *pb.ReorderSectionsRequest) (*pb.ReorderSectionsResponse, error) {
	if _, _, err := s.requireAccess(ctx, req.GetDocumentId(), pb.Role_ROLE_EDITOR); err != nil {
		return nil, err
	}
	sections, err := s.Repos.Section.Reorder(ctx, req.GetDocumentId(), req.GetSectionIds())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to reorder sections: %v", err)
	}
	pbSections := make([]*pb.Section, 0, len(sections))
	for _, sec := range sections {
		pbSections = append(pbSections, sectionToProto(&sec))
	}
	return &pb.ReorderSectionsResponse{Sections: pbSections}, nil
}

func (s *DocumentService) DeleteDocument(ctx context.Context, req *pb.DeleteDocumentRequest) (*pb.DeleteDocumentResponse, error) {
	doc, _, err := s.requireAccess(ctx, req.GetId(), pb.Role_ROLE_OWNER)
	if err != nil {
		return nil, err
	}
	ownerID := doc.OwnerID
	// Ownership is proven by the document delete itself; the cascade runs
	// after it so a non-owner never reaches the child deletes (FR-DAT-01).
	if err := s.Repos.Document.Delete(ctx, req.GetId(), ownerID); err != nil {
		return nil, err
	}
	s.cascadeDelete(ctx, req.GetId())
	return &pb.DeleteDocumentResponse{}, nil
}

func documentToProto(doc *repository.Document, role pb.Role) *pb.Document {
	metadata := doc.Metadata
	if metadata == nil {
		metadata = map[string]string{}
	}
	return &pb.Document{
		Id:              doc.ID,
		OwnerId:         doc.OwnerID,
		TemplateId:      doc.TemplateID,
		TemplateVersion: int32(doc.TemplateVersion),
		Title:           doc.Title,
		Metadata:        metadata,
		Settings: &pb.Settings{
			CitationStyle:     doc.Settings.CitationStyle,
			NumberingMode:     doc.Settings.NumberingMode,
			IncludeUncited:    doc.Settings.IncludeUncited,
			TableContinuation: doc.Settings.TableContinuation,
		},
		MetadataRevision: int32(doc.MetadataRevision),
		MyRole:           role,
		CreatedAt:        timestamppb.New(doc.CreatedAt),
		UpdatedAt:        timestamppb.New(doc.UpdatedAt),
	}
}

func sectionToProto(sec *repository.Section) *pb.Section {
	kind := pb.SectionKind_SECTION_KIND_CHAPTER
	if sec.Kind == "appendix" {
		kind = pb.SectionKind_SECTION_KIND_APPENDIX
	}
	content := "{}"
	if len(sec.Content) > 0 {
		if b, err := json.Marshal(sec.Content); err == nil {
			content = string(b)
		}
	}
	return &pb.Section{
		Id:                sec.ID,
		TemplateSectionId: sec.TemplateSectionID,
		Title:             sec.Title,
		Kind:              kind,
		Order:             int32(sec.OrderIndex),
		Required:          sec.Required,
		Revision:          int32(sec.Revision),
		ContentJson:       content,
		UpdatedAt:         timestamppb.New(sec.UpdatedAt),
	}
}

// cascadeDelete removes everything that hangs off a deleted document, across
// both stores (FR-DAT-01): child records in SurrealDB and export artifacts +
// embedded images in MinIO. Referential integrity is application-enforced —
// neither store does it for us.
//
// Failures are logged, not returned: the document is already gone, so the
// delete has succeeded from the caller's point of view and retrying it would
// just 404. Anything left behind is an orphan blob, not a correctness bug.
func (s *DocumentService) cascadeDelete(ctx context.Context, documentID string) {
	jobs, err := s.Repos.ExportJob.ListByDocument(ctx, documentID)
	if err != nil {
		slog.WarnContext(ctx, "cascade delete: list export jobs", "document_id", documentID, "error", err)
	}
	for _, job := range jobs {
		for _, artifact := range job.Artifacts {
			if _, err := s.Clients.Files.Delete(ctx, &filepb.DeleteRequest{Id: artifact.FileKey}); err != nil {
				slog.WarnContext(ctx, "cascade delete: remove export artifact", "file_key", artifact.FileKey, "error", err)
			}
		}
	}

	sections, err := s.Repos.Section.ListByDocument(ctx, documentID)
	if err != nil {
		slog.WarnContext(ctx, "cascade delete: list sections", "document_id", documentID, "error", err)
	}
	imageKeys := map[string]bool{}
	for i := range sections {
		collectImageObjectKeys(sections[i].Content, imageKeys)
	}
	for key := range imageKeys {
		if _, err := s.Clients.Files.Delete(ctx, &filepb.DeleteRequest{Id: key}); err != nil {
			slog.WarnContext(ctx, "cascade delete: remove image", "file_key", key, "error", err)
		}
	}

	for _, del := range []struct {
		what string
		fn   func(context.Context, string) error
	}{
		{"sections", s.Repos.Section.DeleteByDocument},
		{"sources", s.Repos.Source.DeleteByDocument},
		{"snapshots", s.Repos.Snapshot.DeleteByDocument},
		{"export jobs", s.Repos.ExportJob.DeleteByDocument},
		{"shares", s.Repos.Share.DeleteByDocument},
		{"comments", s.Repos.Comment.DeleteByDocument},
		{"suggestions", s.Repos.Suggestion.DeleteByDocument},
		{"read cursors", s.Repos.ReadCursor.DeleteByDocument},
	} {
		if err := del.fn(ctx, documentID); err != nil {
			slog.WarnContext(ctx, "cascade delete failed", "what", del.what, "document_id", documentID, "error", err)
		}
	}
}

// listSharedDocuments backs `filter=shared` (FR-API-07): documents someone
// else owns that a live share grants this user access to.
func (s *DocumentService) listSharedDocuments(ctx context.Context, userID string) (*pb.ListDocumentsResponse, error) {
	shares, err := s.Repos.Share.ListForUser(ctx, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list shares: %v", err)
	}

	docs := make([]*pb.Document, 0, len(shares))
	seen := map[string]bool{}
	for i := range shares {
		share := &shares[i]
		if seen[share.DocumentID] {
			continue
		}
		seen[share.DocumentID] = true

		doc, err := s.Repos.Document.GetByID(ctx, share.DocumentID)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to load shared document: %v", err)
		}
		// A share can outlive its document (deletes cascade shares, but a
		// concurrent delete can race a list) — skip rather than fail.
		if doc == nil {
			continue
		}
		docs = append(docs, documentToProto(doc, roleFromString(share.Role)))
	}

	return &pb.ListDocumentsResponse{Documents: docs, TotalCount: int32(len(docs))}, nil
}

// isStaleRevision reports whether a repository error is the optimistic
// concurrency conflict (FR-DAT-02).
func isStaleRevision(err error) bool {
	return errors.Is(err, repository.ErrStaleRevision)
}
