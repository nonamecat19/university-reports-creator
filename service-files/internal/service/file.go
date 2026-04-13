package service

import (
	"context"
	"fmt"
	"io"
	"log/slog"

	"connectrpc.com/connect"

	"github.com/google/uuid"
	"github.com/nnc/university-reports-creator/gen/go/file"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type FileService struct {
	minio  *minio.Client
	bucket string
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
		minio:  client,
		bucket: bucket,
	}, nil
}

func (s *FileService) Upload(ctx context.Context, req *connect.Request[file.UploadRequest]) (*connect.Response[file.UploadResponse], error) {
	id := uuid.New().String()

	_, err := s.minio.PutObject(ctx, s.bucket, id, io.NopCloser(
		io.Reader(&dataReader{data: req.Msg.Data})), int64(len(req.Msg.Data)), minio.PutObjectOptions{
		ContentType: req.Msg.ContentType,
		UserMetadata: map[string]string{
			"filename": req.Msg.Filename,
		},
	})
	if err != nil {
		slog.Error("failed to upload file", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to upload file: %w", err))
	}

	return connect.NewResponse(&file.UploadResponse{
		Id:       id,
		Filename: req.Msg.Filename,
		Size:     int64(len(req.Msg.Data)),
	}), nil
}

func (s *FileService) Download(ctx context.Context, req *connect.Request[file.DownloadRequest]) (*connect.Response[file.DownloadResponse], error) {
	obj, err := s.minio.GetObject(ctx, s.bucket, req.Msg.Id, minio.GetObjectOptions{})
	if err != nil {
		slog.Error("failed to get file", "error", err)
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found: %w", err))
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		slog.Error("failed to read file", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to read file: %w", err))
	}

	stat, err := obj.Stat()
	if err != nil {
		slog.Error("failed to stat file", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to stat file: %w", err))
	}

	filename := stat.UserMetadata["filename"]
	if filename == "" {
		filename = req.Msg.Id
	}

	return connect.NewResponse(&file.DownloadResponse{
		Id:          req.Msg.Id,
		Filename:    filename,
		ContentType: stat.ContentType,
		Data:        data,
	}), nil
}

func (s *FileService) Delete(ctx context.Context, req *connect.Request[file.DeleteRequest]) (*connect.Response[emptypb.Empty], error) {
	err := s.minio.RemoveObject(ctx, s.bucket, req.Msg.Id, minio.RemoveObjectOptions{})
	if err != nil {
		slog.Error("failed to delete file", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete file: %w", err))
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (s *FileService) List(ctx context.Context, req *connect.Request[file.ListRequest]) (*connect.Response[file.ListResponse], error) {
	objects := s.minio.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{})

	var files []*file.FileInfo
	for obj := range objects {
		if obj.Err != nil {
			slog.Error("failed to list objects", "error", obj.Err)
			continue
		}

		files = append(files, &file.FileInfo{
			Id:          obj.Key,
			Filename:    obj.UserMetadata["filename"],
			ContentType: obj.ContentType,
			Size:        obj.Size,
		})
	}

	return connect.NewResponse(&file.ListResponse{Files: files}), nil
}

type dataReader struct {
	data []byte
	pos  int
}

func (r *dataReader) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
