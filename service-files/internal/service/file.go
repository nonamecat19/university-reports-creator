package service

import (
	"context"
	"fmt"
	"io"
	"log/slog"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	pb "github.com/nnc/university-reports-creator/gen/go/file"
)

type FileService struct {
	pb.UnimplementedFileServiceServer
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

func (s *FileService) Upload(ctx context.Context, req *pb.UploadRequest) (*pb.UploadResponse, error) {
	id := uuid.New().String()

	_, err := s.minio.PutObject(ctx, s.bucket, id, io.NopCloser(&dataReader{data: req.GetData()}), int64(len(req.GetData())), minio.PutObjectOptions{
		ContentType: req.GetContentType(),
		UserMetadata: map[string]string{
			"filename": req.GetFilename(),
		},
	})
	if err != nil {
		slog.Error("failed to upload file", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to upload file: %v", err)
	}

	return &pb.UploadResponse{
		Id:       id,
		Filename: req.GetFilename(),
		Size:     int64(len(req.GetData())),
	}, nil
}

func (s *FileService) Download(ctx context.Context, req *pb.DownloadRequest) (*pb.DownloadResponse, error) {
	obj, err := s.minio.GetObject(ctx, s.bucket, req.GetId(), minio.GetObjectOptions{})
	if err != nil {
		slog.Error("failed to get file", "error", err)
		return nil, status.Errorf(codes.NotFound, "file not found: %v", err)
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		slog.Error("failed to read file", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to read file: %v", err)
	}

	stat, err := obj.Stat()
	if err != nil {
		slog.Error("failed to stat file", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to stat file: %v", err)
	}

	filename := stat.UserMetadata["filename"]
	if filename == "" {
		filename = req.GetId()
	}

	return &pb.DownloadResponse{
		Id:          req.GetId(),
		Filename:    filename,
		ContentType: stat.ContentType,
		Data:        data,
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
	objects := s.minio.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{})

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
