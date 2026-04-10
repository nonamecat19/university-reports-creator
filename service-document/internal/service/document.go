package service

import (
	"context"
	"fmt"

	pb "github.com/nnc/university-reports-creator/service-document/gen/document"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type DocumentService struct {
	pb.UnimplementedDocumentServiceServer
	Base
}

func (s *DocumentService) CreateDocument(ctx context.Context, req *pb.CreateDocumentRequest) (*pb.DocumentResponse, error) {
	doc, err := s.Repos.Document.Create(ctx, req.GetName(), req.GetContent())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create document: %v", err)
	}

	return &pb.DocumentResponse{Document: toProto(doc)}, nil
}

func (s *DocumentService) GetDocument(ctx context.Context, req *pb.GetDocumentRequest) (*pb.DocumentResponse, error) {
	doc, err := s.Repos.Document.GetByID(ctx, req.GetId())
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "document not found: %v", err)
	}

	return &pb.DocumentResponse{Document: toProto(doc)}, nil
}

func (s *DocumentService) ListDocuments(ctx context.Context, req *pb.ListDocumentsRequest) (*pb.ListDocumentsResponse, error) {
	docs, err := s.Repos.Document.List(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list documents: %v", err)
	}

	var pbDocs []*pb.Document
	for _, d := range docs {
		pbDocs = append(pbDocs, toProto(&d))
	}

	return &pb.ListDocumentsResponse{Documents: pbDocs}, nil
}

func (s *DocumentService) UpdateDocument(ctx context.Context, req *pb.UpdateDocumentRequest) (*pb.DocumentResponse, error) {
	doc, err := s.Repos.Document.Update(ctx, req.GetId(), req.GetName(), req.GetContent())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update document: %v", err)
	}

	return &pb.DocumentResponse{Document: toProto(doc)}, nil
}

func (s *DocumentService) DeleteDocument(ctx context.Context, req *pb.DeleteDocumentRequest) (*pb.DeleteDocumentResponse, error) {
	if err := s.Repos.Document.Delete(ctx, req.GetId()); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete document: %v", err)
	}

	return &pb.DeleteDocumentResponse{}, nil
}

func toProto(doc *repository.Document) *pb.Document {
	var id string
	if doc.ID != nil {
		id = fmt.Sprintf("%v", doc.ID.ID)
	}

	return &pb.Document{
		Id:      id,
		Name:    doc.Name,
		Content: doc.Content,
	}
}
