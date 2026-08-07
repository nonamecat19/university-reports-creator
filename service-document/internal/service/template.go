package service

import (
	"context"
	"encoding/json"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	renderpb "github.com/nnc/university-reports-creator/gen/go/render"
	pb "github.com/nnc/university-reports-creator/gen/go/template"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcerr"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

type TemplateService struct {
	pb.UnimplementedTemplateServiceServer
	Base
}

func (s *TemplateService) CreateTemplate(ctx context.Context, req *pb.CreateTemplateRequest) (*pb.TemplateResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, grpcerr.InvalidArgument("name is required", grpcerr.FieldViolation{Field: "name", Description: "must not be empty"})
	}

	var model map[string]any
	var warnings []string
	if req.GetFileRef() != "" {
		model, warnings, err = s.parseTemplateFile(ctx, req.GetFileRef())
		if err != nil {
			return nil, err
		}
	}

	tmpl, version, err := s.Repos.Template.Create(ctx, ownerID, req.GetName(), req.GetDescription(), reportTypeToString(req.GetReportType()), req.GetFileRef())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create template: %v", err)
	}

	if model != nil {
		version, err = s.Repos.Template.SetParsedModel(ctx, tmpl.ID, version.Version, model, warnings)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to store parsed template model: %v", err)
		}
	}

	return templateResponse(tmpl, version), nil
}

// parseTemplateFile fetches the uploaded docx (FR-ARC-07: via service-files)
// and parses it (via service-render's ParseTemplate) into a TemplateModel
// (FR-TPL-08). Malformed uploads surface as InvalidArgument (FR-TPL-10
// "errors reject upload") straight from service-render.
func (s *TemplateService) parseTemplateFile(ctx context.Context, fileRef string) (map[string]any, []string, error) {
	fileResp, err := downloadFile(ctx, s.Clients.Files, fileRef)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to fetch uploaded template file: %v", err)
	}

	parseResp, err := s.Clients.Render.ParseTemplate(ctx, &renderpb.ParseTemplateRequest{
		DocxBytes: fileResp.Data,
		Filename:  fileResp.Filename,
	})
	if err != nil {
		return nil, nil, err
	}

	var model map[string]any
	if err := json.Unmarshal([]byte(parseResp.GetModelJson()), &model); err != nil {
		return nil, nil, status.Errorf(codes.Internal, "render service returned invalid model JSON: %v", err)
	}

	warnings := make([]string, 0, len(parseResp.GetDiagnostics()))
	for _, d := range parseResp.GetDiagnostics() {
		if d.GetSeverity() == "warning" {
			warnings = append(warnings, d.GetMessage())
		}
	}
	return model, warnings, nil
}

func (s *TemplateService) ConfirmTemplate(ctx context.Context, req *pb.ConfirmTemplateRequest) (*pb.TemplateResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	tmpl, err := s.Repos.Template.GetByID(ctx, req.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get template: %v", err)
	}
	if tmpl == nil || tmpl.OwnerID != ownerID {
		return nil, status.Errorf(codes.NotFound, "template %q not found", req.GetId())
	}

	raw := req.GetAdjustedModelJson()
	var model map[string]any
	if raw == "" {
		// No edits from the review screen (FR-TPL-11): keep the auto-parsed
		// model as-is rather than wiping it to {}.
		current, err := s.Repos.Template.CurrentVersion(ctx, tmpl.ID, tmpl.CurrentVersion)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to load current template version: %v", err)
		}
		if current == nil {
			return nil, status.Errorf(codes.NotFound, "template version not found")
		}
		model = current.Model
	} else if err := json.Unmarshal([]byte(raw), &model); err != nil {
		return nil, grpcerr.InvalidArgument("adjusted_model_json is not valid JSON", grpcerr.FieldViolation{Field: "adjusted_model_json", Description: "must be valid JSON"})
	}

	version, err := s.Repos.Template.Confirm(ctx, tmpl.ID, tmpl.CurrentVersion, model)
	if err != nil {
		return nil, err
	}
	return templateResponse(tmpl, version), nil
}

func (s *TemplateService) GetTemplate(ctx context.Context, req *pb.GetTemplateRequest) (*pb.TemplateResponse, error) {
	tmpl, err := s.Repos.Template.GetByID(ctx, req.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get template: %v", err)
	}
	if tmpl == nil {
		return nil, status.Errorf(codes.NotFound, "template %q not found", req.GetId())
	}
	version, err := s.Repos.Template.CurrentVersion(ctx, tmpl.ID, tmpl.CurrentVersion)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get template version: %v", err)
	}
	return templateResponse(tmpl, version), nil
}

func (s *TemplateService) ListTemplates(ctx context.Context, req *pb.ListTemplatesRequest) (*pb.ListTemplatesResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	own := req.GetFilter() != pb.TemplateFilter_TEMPLATE_FILTER_PUBLIC

	templates, nextToken, total, err := s.Repos.Template.List(ctx, ownerID, own, reportTypeToString(req.GetReportType()), req.GetQuery(), int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list templates: %v", err)
	}

	pbTemplates := make([]*pb.Template, 0, len(templates))
	for _, t := range templates {
		pbTemplates = append(pbTemplates, templateToProto(&t, nil))
	}

	return &pb.ListTemplatesResponse{
		Templates:     pbTemplates,
		NextPageToken: nextToken,
		TotalCount:    int32(total),
	}, nil
}

func (s *TemplateService) UpdateTemplateMeta(ctx context.Context, req *pb.UpdateTemplateMetaRequest) (*pb.TemplateResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	tmpl, err := s.Repos.Template.UpdateMeta(ctx, req.GetId(), ownerID, req.GetName(), req.GetDescription(), visibilityToString(req.GetVisibility()))
	if err != nil {
		return nil, err
	}
	return templateResponse(tmpl, nil), nil
}

func (s *TemplateService) UploadTemplateVersion(ctx context.Context, req *pb.UploadTemplateVersionRequest) (*pb.TemplateResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}

	var model map[string]any
	var warnings []string
	if req.GetFileRef() != "" {
		model, warnings, err = s.parseTemplateFile(ctx, req.GetFileRef())
		if err != nil {
			return nil, err
		}
	}

	tmpl, version, err := s.Repos.Template.UploadVersion(ctx, req.GetId(), ownerID, req.GetFileRef())
	if err != nil {
		return nil, err
	}

	if model != nil {
		version, err = s.Repos.Template.SetParsedModel(ctx, tmpl.ID, version.Version, model, warnings)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to store parsed template model: %v", err)
		}
	}

	return templateResponse(tmpl, version), nil
}

func (s *TemplateService) DeleteTemplate(ctx context.Context, req *pb.DeleteTemplateRequest) (*pb.DeleteTemplateResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.Repos.Template.DeleteIfUnreferenced(ctx, req.GetId(), ownerID); err != nil {
		return nil, err
	}
	return &pb.DeleteTemplateResponse{}, nil
}

func reportTypeToString(rt pb.ReportType) string {
	switch rt {
	case pb.ReportType_REPORT_TYPE_COURSE:
		return "course"
	case pb.ReportType_REPORT_TYPE_DIPLOMA:
		return "diploma"
	case pb.ReportType_REPORT_TYPE_PRACTICE:
		return "practice"
	case pb.ReportType_REPORT_TYPE_OTHER:
		return "other"
	default:
		return ""
	}
}

func reportTypeToProto(rt string) pb.ReportType {
	switch rt {
	case "course":
		return pb.ReportType_REPORT_TYPE_COURSE
	case "diploma":
		return pb.ReportType_REPORT_TYPE_DIPLOMA
	case "practice":
		return pb.ReportType_REPORT_TYPE_PRACTICE
	case "other":
		return pb.ReportType_REPORT_TYPE_OTHER
	default:
		return pb.ReportType_REPORT_TYPE_UNSPECIFIED
	}
}

func visibilityToString(v pb.Visibility) string {
	if v == pb.Visibility_VISIBILITY_PUBLIC {
		return "public"
	}
	return "private"
}

func visibilityToProto(v string) pb.Visibility {
	if v == "public" {
		return pb.Visibility_VISIBILITY_PUBLIC
	}
	return pb.Visibility_VISIBILITY_PRIVATE
}

func templateToProto(tmpl *repository.Template, version *repository.TemplateVersion) *pb.Template {
	modelJSON := ""
	confirmed := false
	if version != nil {
		confirmed = version.Confirmed
		if len(version.Model) > 0 {
			if b, err := json.Marshal(version.Model); err == nil {
				modelJSON = string(b)
			}
		}
	}
	return &pb.Template{
		Id:             tmpl.ID,
		OwnerId:        tmpl.OwnerID,
		Name:           tmpl.Name,
		Description:    tmpl.Description,
		ReportType:     reportTypeToProto(tmpl.ReportType),
		Visibility:     visibilityToProto(tmpl.Visibility),
		CurrentVersion: int32(tmpl.CurrentVersion),
		ModelJson:      modelJSON,
		Confirmed:      confirmed,
		CreatedAt:      timestamppb.New(tmpl.CreatedAt),
		UpdatedAt:      timestamppb.New(tmpl.UpdatedAt),
	}
}

func templateResponse(tmpl *repository.Template, version *repository.TemplateVersion) *pb.TemplateResponse {
	var warnings []string
	if version != nil {
		warnings = version.Warnings
	}
	return &pb.TemplateResponse{
		Template: templateToProto(tmpl, version),
		Warnings: warnings,
	}
}
