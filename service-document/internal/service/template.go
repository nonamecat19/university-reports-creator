package service

import (
	"context"
	"fmt"

	pb "github.com/nnc/university-reports-creator/gen/go/template"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type TemplateService struct {
	pb.UnimplementedTemplateServiceServer
	Base
}

func (s *TemplateService) CreateTemplate(ctx context.Context, req *pb.CreateTemplateRequest) (*pb.TemplateResponse, error) {
	tmpl, err := s.Repos.Template.Create(ctx, req.GetName(), req.GetContent())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create template: %v", err)
	}

	return &pb.TemplateResponse{Template: templateToProto(tmpl)}, nil
}

func (s *TemplateService) GetTemplate(ctx context.Context, req *pb.GetTemplateRequest) (*pb.TemplateResponse, error) {
	tmpl, err := s.Repos.Template.GetByID(ctx, req.GetId())
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "template not found: %v", err)
	}

	return &pb.TemplateResponse{Template: templateToProto(tmpl)}, nil
}

func (s *TemplateService) ListTemplates(ctx context.Context, req *pb.ListTemplatesRequest) (*pb.ListTemplatesResponse, error) {
	tmpls, err := s.Repos.Template.List(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list templates: %v", err)
	}

	var pbTmpls []*pb.Template
	for _, t := range tmpls {
		pbTmpls = append(pbTmpls, templateToProto(&t))
	}

	return &pb.ListTemplatesResponse{Templates: pbTmpls}, nil
}

func (s *TemplateService) UpdateTemplate(ctx context.Context, req *pb.UpdateTemplateRequest) (*pb.TemplateResponse, error) {
	tmpl, err := s.Repos.Template.Update(ctx, req.GetId(), req.GetName(), req.GetContent())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update template: %v", err)
	}

	return &pb.TemplateResponse{Template: templateToProto(tmpl)}, nil
}

func (s *TemplateService) DeleteTemplate(ctx context.Context, req *pb.DeleteTemplateRequest) (*pb.DeleteTemplateResponse, error) {
	if err := s.Repos.Template.Delete(ctx, req.GetId()); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete template: %v", err)
	}

	return &pb.DeleteTemplateResponse{}, nil
}

func templateToProto(tmpl *repository.Template) *pb.Template {
	var id string
	if tmpl.ID != nil {
		id = fmt.Sprintf("%v", tmpl.ID.ID)
	}

	return &pb.Template{
		Id:      id,
		Name:    tmpl.Name,
		Content: tmpl.Content,
	}
}
