package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	pb "github.com/nnc/university-reports-creator/gen/go/file"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcerr"
)

const (
	// downloadChunkBytes keeps each streamed message well under the default
	// 4 MB gRPC limit while avoiding a message per kilobyte.
	downloadChunkBytes = 1024 * 1024
	// presignedURLTTL — long enough to start a browser download, short enough
	// that a leaked link is worthless (FR-API-13).
	presignedURLTTL = 15 * time.Minute
	sweepInterval   = time.Minute
)

type FileService struct {
	pb.UnimplementedFileServiceServer
	minio    *minio.Client
	bucket   string
	sessions *sessionStore
}

func New(minioEndpoint, accessKey, secretKey, bucket string, useSSL bool) (*FileService, error) {
	client, err := minio.New(minioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("minio client: %w", err)
	}

	return &FileService{
		minio:    client,
		bucket:   bucket,
		sessions: newSessionStore(SessionTTL),
	}, nil
}

// StartSessionSweeper drops abandoned upload sessions on a timer (FR-API-13).
// Runs until the context is cancelled.
func (s *FileService) StartSessionSweeper(ctx context.Context) {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if removed := s.sessions.sweep(); removed > 0 {
				slog.Info("dropped abandoned upload sessions", "count", removed)
			}
		}
	}
}

// ── Upload: unary chunk session (FR-API-13) ─────────────────────────────

func (s *FileService) BeginUpload(_ context.Context, req *pb.BeginUploadRequest) (*pb.BeginUploadResponse, error) {
	purpose, rules := resolvePurpose(req.GetPurpose())
	if err := validateDeclaredSize(req.GetSize(), rules); err != nil {
		return nil, err
	}

	session := &uploadSession{
		id:           uuid.New().String(),
		purpose:      purpose,
		rules:        rules,
		filename:     req.GetFilename(),
		declaredSize: req.GetSize(),
		buffer:       make([]byte, 0, req.GetSize()),
	}
	s.sessions.put(session)

	return &pb.BeginUploadResponse{
		UploadId:         session.id,
		MaxChunkBytes:    MaxChunkBytes,
		ExpiresInSeconds: int32(SessionTTL.Seconds()),
	}, nil
}

func (s *FileService) UploadChunk(_ context.Context, req *pb.UploadChunkRequest) (*pb.UploadChunkResponse, error) {
	session, ok := s.sessions.get(req.GetUploadId())
	if !ok {
		return nil, status.Errorf(codes.NotFound, "upload session %q not found or expired", req.GetUploadId())
	}

	if len(req.GetData()) > MaxChunkBytes {
		return nil, grpcerr.ResourceExhausted(fmt.Sprintf("chunk exceeds the %d MB limit", MaxChunkBytes/(1024*1024)))
	}

	// A retried chunk repeats the previous seq; accepting it as a no-op makes
	// the protocol safe to retry without duplicating bytes.
	if req.GetSeq() == session.nextSeq-1 {
		return &pb.UploadChunkResponse{ReceivedBytes: int64(len(session.buffer)), NextSeq: session.nextSeq}, nil
	}
	if req.GetSeq() != session.nextSeq {
		return nil, grpcerr.InvalidArgument(
			fmt.Sprintf("chunk out of order: expected seq %d, got %d", session.nextSeq, req.GetSeq()),
			grpcerr.FieldViolation{Field: "seq", Description: "chunks must arrive in order"})
	}

	if int64(len(session.buffer)+len(req.GetData())) > session.rules.maxBytes {
		s.sessions.remove(session.id)
		return nil, grpcerr.ResourceExhausted(
			fmt.Sprintf("upload exceeds the %d MB limit for %s", session.rules.maxBytes/(1024*1024), purposeName(session.purpose)))
	}

	session.buffer = append(session.buffer, req.GetData()...)
	session.nextSeq++
	s.sessions.touch(session)

	return &pb.UploadChunkResponse{ReceivedBytes: int64(len(session.buffer)), NextSeq: session.nextSeq}, nil
}

// CompleteUpload is where every check happens: declared size against received
// size, and the sniffed content type against what the purpose accepts. Nothing
// reaches MinIO before both pass.
func (s *FileService) CompleteUpload(ctx context.Context, req *pb.CompleteUploadRequest) (*pb.UploadResponse, error) {
	session, ok := s.sessions.get(req.GetUploadId())
	if !ok {
		return nil, status.Errorf(codes.NotFound, "upload session %q not found or expired", req.GetUploadId())
	}
	defer s.sessions.remove(session.id)

	received := int64(len(session.buffer))
	if session.declaredSize > 0 && received != session.declaredSize {
		return nil, grpcerr.InvalidArgument(
			fmt.Sprintf("declared %d bytes but received %d", session.declaredSize, received),
			grpcerr.FieldViolation{Field: "size", Description: "declared size does not match the uploaded bytes"})
	}
	if received == 0 {
		return nil, grpcerr.InvalidArgument("upload is empty",
			grpcerr.FieldViolation{Field: "data", Description: "no chunks were received"})
	}

	contentType, err := validateContent(session.buffer, session.purpose, session.rules)
	if err != nil {
		return nil, err
	}

	return s.store(ctx, session.rules.prefix, session.filename, contentType, session.buffer)
}

func (s *FileService) AbortUpload(_ context.Context, req *pb.AbortUploadRequest) (*emptypb.Empty, error) {
	s.sessions.remove(req.GetUploadId())
	return &emptypb.Empty{}, nil
}

// Upload is the single-shot path, held to the same validation as a session.
func (s *FileService) Upload(ctx context.Context, req *pb.UploadRequest) (*pb.UploadResponse, error) {
	purpose, rules := resolvePurpose(req.GetPurpose())
	data := req.GetData()

	if err := validateDeclaredSize(int64(len(data)), rules); err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, grpcerr.InvalidArgument("upload is empty",
			grpcerr.FieldViolation{Field: "data", Description: "must not be empty"})
	}

	contentType, err := validateContent(data, purpose, rules)
	if err != nil {
		return nil, err
	}

	return s.store(ctx, rules.prefix, req.GetFilename(), contentType, data)
}

func (s *FileService) store(ctx context.Context, prefix, filename, contentType string, data []byte) (*pb.UploadResponse, error) {
	id := prefix + uuid.New().String()

	if _, err := s.minio.PutObject(ctx, s.bucket, id, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType:  contentType,
		UserMetadata: map[string]string{"filename": filename},
	}); err != nil {
		slog.Error("failed to upload file", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to upload file: %v", err)
	}

	return &pb.UploadResponse{
		Id:          id,
		Filename:    filename,
		Size:        int64(len(data)),
		ContentType: contentType,
	}, nil
}

// ── Download ────────────────────────────────────────────────────────────

// Download streams the object (FR-API-13). Server streaming is the one
// streaming direction gRPC-web supports, so the browser and the Go services
// use the same RPC.
func (s *FileService) Download(req *pb.DownloadRequest, stream pb.FileService_DownloadServer) error {
	ctx := stream.Context()

	obj, err := s.minio.GetObject(ctx, s.bucket, req.GetId(), minio.GetObjectOptions{})
	if err != nil {
		slog.Error("failed to get file", "error", err)
		return status.Errorf(codes.NotFound, "file not found: %v", err)
	}
	defer obj.Close()

	stat, err := obj.Stat()
	if err != nil {
		slog.Error("failed to stat file", "error", err)
		return status.Errorf(codes.NotFound, "file not found: %v", err)
	}

	filename := stat.UserMetadata["filename"]
	if filename == "" {
		filename = req.GetId()
	}

	// The metadata rides on the first message so a consumer knows the filename
	// and type before it has all the bytes.
	first := &pb.DownloadChunk{
		Id:          req.GetId(),
		Filename:    filename,
		ContentType: stat.ContentType,
		Size:        stat.Size,
	}

	buf := make([]byte, downloadChunkBytes)
	for {
		n, readErr := obj.Read(buf)
		if n > 0 {
			chunk := first
			if chunk == nil {
				chunk = &pb.DownloadChunk{}
			}
			first = nil
			chunk.Data = buf[:n]
			if err := stream.Send(chunk); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			slog.Error("failed to read file", "error", readErr)
			return status.Errorf(codes.Internal, "failed to read file: %v", readErr)
		}
	}

	// An empty object still owes the caller its metadata.
	if first != nil {
		if err := stream.Send(first); err != nil {
			return err
		}
	}
	return nil
}

// GetDownloadURL hands back a short-lived presigned URL so large binaries are
// fetched straight from object storage instead of streaming through the
// gateway (FR-API-13).
func (s *FileService) GetDownloadURL(ctx context.Context, req *pb.GetDownloadURLRequest) (*pb.GetDownloadURLResponse, error) {
	params := url.Values{}
	presigned, err := s.minio.PresignedGetObject(ctx, s.bucket, req.GetId(), presignedURLTTL, params)
	if err != nil {
		slog.Error("failed to presign download URL", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to create download URL: %v", err)
	}

	return &pb.GetDownloadURLResponse{
		Url:              presigned.String(),
		ExpiresInSeconds: int32(presignedURLTTL.Seconds()),
	}, nil
}

func (s *FileService) Delete(ctx context.Context, req *pb.DeleteRequest) (*emptypb.Empty, error) {
	if err := s.minio.RemoveObject(ctx, s.bucket, req.GetId(), minio.RemoveObjectOptions{}); err != nil {
		slog.Error("failed to delete file", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to delete file: %v", err)
	}

	return &emptypb.Empty{}, nil
}

func (s *FileService) List(ctx context.Context, _ *pb.ListRequest) (*pb.ListResponse, error) {
	objects := s.minio.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{Recursive: true})

	var files []*pb.FileInfo
	for obj := range objects {
		if obj.Err != nil {
			slog.Error("failed to list objects", "error", obj.Err)
			continue
		}

		files = append(files, &pb.FileInfo{
			Id:          obj.Key,
			Filename:    obj.UserMetadata["filename"],
			ContentType: obj.ContentType,
			Size:        obj.Size,
		})
	}

	return &pb.ListResponse{Files: files}, nil
}
