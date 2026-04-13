package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"connectrpc.com/connect"
	"github.com/rs/cors"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/nnc/university-reports-creator/gen/go/auth"
	"github.com/nnc/university-reports-creator/gen/go/auth/authconnect"
	"github.com/nnc/university-reports-creator/gen/go/document"
	"github.com/nnc/university-reports-creator/gen/go/document/documentconnect"
	"github.com/nnc/university-reports-creator/gen/go/file"
	"github.com/nnc/university-reports-creator/gen/go/file/fileconnect"
	"github.com/nnc/university-reports-creator/gen/go/template"
	"github.com/nnc/university-reports-creator/gen/go/template/templateconnect"
)

type Config struct {
	HTTPPort  string `env:"HTTP_PORT" envDefault:":8080"`
	AuthAddr  string `env:"AUTH_ADDR" envDefault:":50051"`
	DocAddr   string `env:"DOC_ADDR" envDefault:":50052"`
	FilesAddr string `env:"FILES_ADDR" envDefault:":50053"`
	JWTSecret string `env:"JWT_SECRET" envDefault:"change-me"`
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	cfg := Config{
		HTTPPort:  getEnv("HTTP_PORT", ":8080"),
		AuthAddr:  getEnv("AUTH_ADDR", "localhost:50051"),
		DocAddr:   getEnv("DOC_ADDR", "localhost:50052"),
		FilesAddr: getEnv("FILES_ADDR", "localhost:50053"),
		JWTSecret: getEnv("JWT_SECRET", "change-me"),
	}

	mux := http.NewServeMux()

	authPath, authHandler := authconnect.NewAuthServiceHandler(&AuthHandler{addr: cfg.AuthAddr})
	mux.Handle(authPath, authHandler)

	docPath, docHandler := documentconnect.NewDocumentServiceHandler(&DocumentHandler{addr: cfg.DocAddr, jwtSecret: cfg.JWTSecret})
	mux.Handle(docPath, docHandler)

	tmplPath, tmplHandler := templateconnect.NewTemplateServiceHandler(&TemplateHandler{addr: cfg.DocAddr, jwtSecret: cfg.JWTSecret})
	mux.Handle(tmplPath, tmplHandler)

	filesPath, filesHandler := fileconnect.NewFileServiceHandler(&FileHandler{addr: cfg.FilesAddr, jwtSecret: cfg.JWTSecret})
	mux.Handle(filesPath, filesHandler)

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000"},
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions},
		AllowedHeaders: []string{"*"},
	}).Handler(mux)

	srv := &http.Server{
		Addr:    cfg.HTTPPort,
		Handler: corsHandler,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("gateway starting on %s", cfg.HTTPPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("failed to serve: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down gateway...")
	srv.Shutdown(context.Background())
}

type AuthHandler struct {
	addr string
}

func (*AuthHandler) ServiceName() string {
	return "/auth.AuthService/"
}

func (h *AuthHandler) Register(ctx context.Context, req *connect.Request[auth.RegisterRequest]) (*connect.Response[auth.RegisterResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("call auth service directly"))
}

func (h *AuthHandler) Login(ctx context.Context, req *connect.Request[auth.LoginRequest]) (*connect.Response[auth.LoginResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("call auth service directly"))
}

func (h *AuthHandler) ValidateToken(ctx context.Context, req *connect.Request[auth.ValidateTokenRequest]) (*connect.Response[auth.ValidateTokenResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("call auth service directly"))
}

func (h *AuthHandler) RefreshToken(ctx context.Context, req *connect.Request[auth.RefreshTokenRequest]) (*connect.Response[auth.RefreshTokenResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("call auth service directly"))
}

type DocumentHandler struct {
	addr      string
	jwtSecret string
}

func (*DocumentHandler) ServiceName() string {
	return "/document.DocumentService/"
}

func (h *DocumentHandler) CreateDocument(ctx context.Context, req *connect.Request[document.CreateDocumentRequest]) (*connect.Response[document.DocumentResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *DocumentHandler) GetDocument(ctx context.Context, req *connect.Request[document.GetDocumentRequest]) (*connect.Response[document.DocumentResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *DocumentHandler) ListDocuments(ctx context.Context, req *connect.Request[document.ListDocumentsRequest]) (*connect.Response[document.ListDocumentsResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *DocumentHandler) UpdateDocument(ctx context.Context, req *connect.Request[document.UpdateDocumentRequest]) (*connect.Response[document.DocumentResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *DocumentHandler) DeleteDocument(ctx context.Context, req *connect.Request[document.DeleteDocumentRequest]) (*connect.Response[document.DeleteDocumentResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

type TemplateHandler struct {
	addr      string
	jwtSecret string
}

func (*TemplateHandler) ServiceName() string {
	return "/template.TemplateService/"
}

func (h *TemplateHandler) CreateTemplate(ctx context.Context, req *connect.Request[template.CreateTemplateRequest]) (*connect.Response[template.TemplateResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *TemplateHandler) GetTemplate(ctx context.Context, req *connect.Request[template.GetTemplateRequest]) (*connect.Response[template.TemplateResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *TemplateHandler) ListTemplates(ctx context.Context, req *connect.Request[template.ListTemplatesRequest]) (*connect.Response[template.ListTemplatesResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *TemplateHandler) UpdateTemplate(ctx context.Context, req *connect.Request[template.UpdateTemplateRequest]) (*connect.Response[template.TemplateResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *TemplateHandler) DeleteTemplate(ctx context.Context, req *connect.Request[template.DeleteTemplateRequest]) (*connect.Response[template.DeleteTemplateResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

type FileHandler struct {
	addr      string
	jwtSecret string
}

func (*FileHandler) ServiceName() string {
	return "/file.FileService/"
}

func (h *FileHandler) Upload(ctx context.Context, req *connect.Request[file.UploadRequest]) (*connect.Response[file.UploadResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *FileHandler) Download(ctx context.Context, req *connect.Request[file.DownloadRequest]) (*connect.Response[file.DownloadResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *FileHandler) Delete(ctx context.Context, req *connect.Request[file.DeleteRequest]) (*connect.Response[emptypb.Empty], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}

func (h *FileHandler) List(ctx context.Context, req *connect.Request[file.ListRequest]) (*connect.Response[file.ListResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("not implemented"))
}
