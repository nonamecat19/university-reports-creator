package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "github.com/nnc/university-reports-creator/gen/go/document"
	filepb "github.com/nnc/university-reports-creator/gen/go/file"
	renderpb "github.com/nnc/university-reports-creator/gen/go/render"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
)

// ExportDocument runs the export pipeline synchronously (FR-API-11a): no
// async job queue exists yet, but the job record still lands in SurrealDB so
// GetExportJob/ListExports behave per contract for a client that polls.
func (s *DocumentService) ExportDocument(ctx context.Context, req *pb.ExportDocumentRequest) (*pb.ExportDocumentResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}

	opts := req.GetOptions()
	format := opts.GetFormat()
	if format == "" {
		format = "docx"
	}

	job, err := s.runExportPipeline(ctx, req.GetDocumentId(), ownerID, format, opts.GetSuggestionsStrategy(), opts.GetTableContinuation(), opts.GetIncludeComments())
	if err != nil {
		return nil, err
	}
	return &pb.ExportDocumentResponse{JobId: job.ID}, nil
}

// PreviewPdf runs the same pipeline with the clean strategy, always
// generating a PDF (FR-EXP-09) — the pagination-accurate preview.
func (s *DocumentService) PreviewPdf(ctx context.Context, req *pb.PreviewPdfRequest) (*pb.ExportDocumentResponse, error) {
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	job, err := s.runExportPipeline(ctx, req.GetDocumentId(), ownerID, "docx+pdf", "clean", "repeat_header", false)
	if err != nil {
		return nil, err
	}
	return &pb.ExportDocumentResponse{JobId: job.ID}, nil
}

func (s *DocumentService) GetExportJob(ctx context.Context, req *pb.GetExportJobRequest) (*pb.ExportJobStatus, error) {
	job, err := s.Repos.ExportJob.GetByID(ctx, req.GetJobId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get export job: %v", err)
	}
	if job == nil {
		return nil, status.Errorf(codes.NotFound, "export job %q not found", req.GetJobId())
	}
	return exportJobToProto(job), nil
}

func (s *DocumentService) ListExports(ctx context.Context, req *pb.ListExportsRequest) (*pb.ListExportsResponse, error) {
	jobs, err := s.Repos.ExportJob.ListByDocument(ctx, req.GetDocumentId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list export jobs: %v", err)
	}
	out := make([]*pb.ExportJobStatus, 0, len(jobs))
	for i := range jobs {
		out = append(out, exportJobToProto(&jobs[i]))
	}
	return &pb.ListExportsResponse{Jobs: out}, nil
}

func (s *DocumentService) runExportPipeline(
	ctx context.Context,
	documentID, ownerID, format, suggestionsStrategy, tableContinuation string,
	includeComments bool,
) (*repository.ExportJob, error) {
	doc, err := s.Repos.Document.GetOwned(ctx, documentID, ownerID)
	if err != nil {
		return nil, err
	}
	if doc.TemplateID == "" {
		return nil, status.Error(codes.FailedPrecondition, "document has no template; export requires one")
	}

	version, err := s.Repos.Template.CurrentVersion(ctx, doc.TemplateID, doc.TemplateVersion)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load template version: %v", err)
	}
	if version == nil || version.FileKey == "" {
		return nil, status.Error(codes.FailedPrecondition, "template has no uploaded docx file")
	}

	template, err := s.Repos.Template.GetByID(ctx, doc.TemplateID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load template: %v", err)
	}

	sections, err := s.Repos.Section.ListByDocument(ctx, doc.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list sections: %v", err)
	}

	job, err := s.Repos.ExportJob.Create(ctx, doc.ID, ownerID, map[string]any{
		"format":               format,
		"suggestions_strategy": suggestionsStrategy,
		"table_continuation":   tableContinuation,
		"include_comments":     includeComments,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create export job: %v", err)
	}

	artifacts, warnings, pipelineErr := s.doExport(ctx, doc, template, version, sections, format, suggestionsStrategy, tableContinuation)
	if pipelineErr != nil {
		if failed, ferr := s.Repos.ExportJob.Fail(ctx, job.ID, pipelineErr.Error()); ferr == nil {
			job = failed
		}
		return nil, status.Errorf(codes.Internal, "export failed: %v", pipelineErr)
	}

	completed, err := s.Repos.ExportJob.Complete(ctx, job.ID, artifacts, warnings)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to mark export job done: %v", err)
	}
	return completed, nil
}

func (s *DocumentService) doExport(
	ctx context.Context,
	doc *repository.Document,
	template *repository.Template,
	version *repository.TemplateVersion,
	sections []repository.Section,
	format, suggestionsStrategy, tableContinuation string,
) ([]repository.ExportArtifact, []string, error) {
	templateFile, err := s.Clients.Files.Download(ctx, &filepb.DownloadRequest{Id: version.FileKey})
	if err != nil {
		return nil, nil, fmt.Errorf("fetch template file: %w", err)
	}

	renderSections := make([]*renderpb.RenderSection, 0, len(sections))
	imageKeys := map[string]bool{}
	for i := range sections {
		sec := &sections[i]
		contentJSON, err := json.Marshal(sec.Content)
		if err != nil {
			return nil, nil, fmt.Errorf("marshal section %q content: %w", sec.ID, err)
		}
		collectImageObjectKeys(sec.Content, imageKeys)
		renderSections = append(renderSections, &renderpb.RenderSection{
			Id:                sec.ID,
			TemplateSectionId: sec.TemplateSectionID,
			Title:             sec.Title,
			Kind:              sectionKindToRenderProto(sec.Kind),
			Order:             int32(sec.OrderIndex),
			ContentJson:       string(contentJSON),
		})
	}

	images := make(map[string][]byte, len(imageKeys))
	for key := range imageKeys {
		fileResp, err := s.Clients.Files.Download(ctx, &filepb.DownloadRequest{Id: key})
		if err != nil {
			continue // missing image: skip, translator just omits it
		}
		images[key] = fileResp.GetData()
	}

	modelJSON, _ := json.Marshal(version.Model)

	renderResp, err := s.Clients.Render.RenderDocx(ctx, &renderpb.RenderDocxRequest{
		TemplateDocx: templateFile.GetData(),
		ModelJson:    string(modelJSON),
		Metadata:     doc.Metadata,
		Sections:     renderSections,
		// Bibliography source management isn't wired up yet (06-bibliography.md);
		// the {{bibliography}} marker, if present, renders as an empty list.
		SourcesCslJson: []string{},
		Options: &renderpb.RenderOptions{
			NumberingMode:       doc.Settings.NumberingMode,
			TableContinuation:   tableContinuation,
			IncludeUncited:      doc.Settings.IncludeUncited,
			SuggestionsStrategy: suggestionsStrategy,
			IncludeComments:     false,
		},
		Images: images,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("render docx: %w", err)
	}

	warnings := make([]string, 0, len(renderResp.GetWarnings()))
	for _, w := range renderResp.GetWarnings() {
		warnings = append(warnings, w.GetMessage())
	}

	baseFilename := exportFilename(doc, template)
	artifacts := make([]repository.ExportArtifact, 0, 2)

	docxUpload, err := s.Clients.Files.Upload(ctx, &filepb.UploadRequest{
		Filename:    baseFilename + ".docx",
		ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		Data:        renderResp.GetDocxBytes(),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("store docx artifact: %w", err)
	}
	artifacts = append(artifacts, repository.ExportArtifact{Kind: "docx", FileKey: docxUpload.GetId(), Filename: baseFilename + ".docx"})

	if format == "docx+pdf" {
		pdfResp, err := s.Clients.Render.ConvertPdf(ctx, &renderpb.ConvertPdfRequest{DocxBytes: renderResp.GetDocxBytes()})
		if err != nil {
			// FR-EXP-08: PDF conversion failure still delivers the docx; PDF
			// is just marked failed via a warning rather than the whole job.
			warnings = append(warnings, fmt.Sprintf("PDF conversion failed: %v", err))
		} else {
			pdfUpload, err := s.Clients.Files.Upload(ctx, &filepb.UploadRequest{
				Filename:    baseFilename + ".pdf",
				ContentType: "application/pdf",
				Data:        pdfResp.GetPdfBytes(),
			})
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("failed to store PDF artifact: %v", err))
			} else {
				artifacts = append(artifacts, repository.ExportArtifact{Kind: "pdf", FileKey: pdfUpload.GetId(), Filename: baseFilename + ".pdf"})
			}
		}
	}

	return artifacts, warnings, nil
}

var filenameUnsafe = regexp.MustCompile(`[^a-zA-Z0-9А-Яа-яІіЇїЄєҐґ_-]+`)

// exportFilename builds `{surname}_{report_type}_{topic-slug}_{yyyy-mm-dd}`
// (FR-EXP-07); transliteration is skipped for MVP (Cyrillic filenames are
// fine on every target OS this app runs on).
func exportFilename(doc *repository.Document, template *repository.Template) string {
	surname := firstWord(doc.Metadata["student_name"])
	if surname == "" {
		surname = "document"
	}
	reportType := template.ReportType
	if reportType == "" {
		reportType = "report"
	}
	topic := slugify(doc.Metadata["topic"])
	date := time.Now().Format("2006-01-02")

	parts := []string{surname, reportType}
	if topic != "" {
		parts = append(parts, topic)
	}
	parts = append(parts, date)
	return truncateRunes(strings.Join(parts, "_"), 120)
}

func firstWord(s string) string {
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return ""
	}
	return filenameUnsafe.ReplaceAllString(fields[0], "")
}

func slugify(s string) string {
	s = strings.TrimSpace(s)
	s = filenameUnsafe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return truncateRunes(s, 40)
}

// truncateRunes cuts on rune boundaries — a byte-offset slice (name[:n]) can
// split a multi-byte UTF-8 character in half and produce a string that fails
// proto's UTF-8 validation on marshal (filenames here are routinely Cyrillic).
func truncateRunes(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes])
}

func sectionKindToRenderProto(kind string) renderpb.SectionKind {
	if kind == "appendix" {
		return renderpb.SectionKind_SECTION_KIND_APPENDIX
	}
	return renderpb.SectionKind_SECTION_KIND_CHAPTER
}

// collectImageObjectKeys walks a ProseMirror JSON tree (decoded via the
// generic map[string]any produced by SurrealDB's CBOR driver) collecting
// every image node's objectKey attribute.
func collectImageObjectKeys(node map[string]any, out map[string]bool) {
	if node == nil {
		return
	}
	if node["type"] == "image" {
		if attrs, ok := node["attrs"].(map[string]any); ok {
			if key, ok := attrs["objectKey"].(string); ok && key != "" {
				out[key] = true
			}
		}
	}
	content, ok := node["content"].([]any)
	if !ok {
		return
	}
	for _, child := range content {
		if childMap, ok := child.(map[string]any); ok {
			collectImageObjectKeys(childMap, out)
		}
	}
}

func exportJobToProto(job *repository.ExportJob) *pb.ExportJobStatus {
	artifacts := make([]*pb.ExportArtifact, 0, len(job.Artifacts))
	for _, a := range job.Artifacts {
		artifacts = append(artifacts, &pb.ExportArtifact{Kind: a.Kind, FileKey: a.FileKey, Filename: a.Filename})
	}
	status := &pb.ExportJobStatus{
		JobId:      job.ID,
		DocumentId: job.DocumentID,
		Status:     job.Status,
		Stage:      job.Stage,
		Warnings:   job.Warnings,
		Artifacts:  artifacts,
		Error:      job.Error,
		CreatedAt:  timestamppb.New(job.CreatedAt),
	}
	if job.FinishedAt != nil {
		status.FinishedAt = timestamppb.New(*job.FinishedAt)
	}
	return status
}
