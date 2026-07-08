package service

import (
	"context"
	"encoding/json"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/nnc/university-reports-creator/gen/go/document"
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
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}

	doc, err := s.Repos.Document.GetOwned(ctx, req.GetId(), ownerID)
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
		Document: documentToProto(doc, pb.Role_ROLE_OWNER),
		Sections: pbSections,
	}, nil
}

func (s *DocumentService) ListDocuments(ctx context.Context, req *pb.ListDocumentsRequest) (*pb.ListDocumentsResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}

	// Shared documents (FR-API-07 filter=shared) land with review mode (P4);
	// P1 only has owned documents.
	if req.GetFilter() == pb.DocumentFilter_DOCUMENT_FILTER_SHARED {
		return &pb.ListDocumentsResponse{}, nil
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
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := s.Repos.Document.Rename(ctx, req.GetId(), ownerID, req.GetTitle())
	if err != nil {
		return nil, err
	}
	return &pb.DocumentResponse{Document: documentToProto(doc, pb.Role_ROLE_OWNER)}, nil
}

func (s *DocumentService) UpdateMetadata(ctx context.Context, req *pb.UpdateMetadataRequest) (*pb.DocumentResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := s.Repos.Document.UpdateMetadata(ctx, req.GetId(), ownerID, req.GetValues(), int(req.GetMetadataRevision()))
	if err != nil {
		if errors.Is(err, repository.ErrStaleRevision) {
			return nil, s.staleMetadataRevisionErr(ctx, req.GetId())
		}
		return nil, err
	}
	return &pb.DocumentResponse{Document: documentToProto(doc, pb.Role_ROLE_OWNER)}, nil
}

func (s *DocumentService) staleMetadataRevisionErr(ctx context.Context, id string) error {
	if current, err := s.Repos.Document.GetByID(ctx, id); err == nil && current != nil {
		return grpcerr.StaleRevision("metadata_revision is stale", int32(current.MetadataRevision))
	}
	return grpcerr.StaleRevision("metadata_revision is stale", 0)
}

func (s *DocumentService) UpdateSettings(ctx context.Context, req *pb.UpdateSettingsRequest) (*pb.DocumentResponse, error) {
	ownerID, err := requireUserID(ctx)
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
	doc, err := s.Repos.Document.UpdateSettings(ctx, req.GetId(), ownerID, settings, int(req.GetMetadataRevision()))
	if err != nil {
		if errors.Is(err, repository.ErrStaleRevision) {
			return nil, s.staleMetadataRevisionErr(ctx, req.GetId())
		}
		return nil, err
	}
	return &pb.DocumentResponse{Document: documentToProto(doc, pb.Role_ROLE_OWNER)}, nil
}

func (s *DocumentService) UpdateSection(ctx context.Context, req *pb.UpdateSectionRequest) (*pb.SectionResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.Repos.Document.GetOwned(ctx, req.GetDocumentId(), ownerID); err != nil {
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
	return &pb.SectionResponse{Section: sectionToProto(section)}, nil
}

func (s *DocumentService) AddSection(ctx context.Context, req *pb.AddSectionRequest) (*pb.SectionResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.Repos.Document.GetOwned(ctx, req.GetDocumentId(), ownerID); err != nil {
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
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.Repos.Document.GetOwned(ctx, req.GetDocumentId(), ownerID); err != nil {
		return nil, err
	}
	if err := s.Repos.Section.Remove(ctx, req.GetDocumentId(), req.GetSectionId()); err != nil {
		return nil, err
	}
	return &pb.RemoveSectionResponse{}, nil
}

func (s *DocumentService) ReorderSections(ctx context.Context, req *pb.ReorderSectionsRequest) (*pb.ReorderSectionsResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.Repos.Document.GetOwned(ctx, req.GetDocumentId(), ownerID); err != nil {
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
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.Repos.Document.Delete(ctx, req.GetId(), ownerID); err != nil {
		return nil, err
	}
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
