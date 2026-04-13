package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/nnc/university-reports-creator/gen/go/auth"
	"github.com/nnc/university-reports-creator/service-auth/internal/model"
	"github.com/nnc/university-reports-creator/service-auth/internal/repository"
	"github.com/nnc/university-reports-creator/service-auth/internal/token"
)

type AuthService struct {
	pb.UnimplementedAuthServiceServer
	repo   repository.UserRepository
	tokens *token.JWTManager
}

func NewAuthService(repo repository.UserRepository, tokens *token.JWTManager) *AuthService {
	return &AuthService{
		repo:   repo,
		tokens: tokens,
	}
}

func (s *AuthService) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	if req.GetEmail() == "" {
		return nil, status.Error(codes.InvalidArgument, "email is required")
	}
	if req.GetPassword() == "" {
		return nil, status.Error(codes.InvalidArgument, "password is required")
	}
	if len(req.GetPassword()) < 6 {
		return nil, status.Error(codes.InvalidArgument, "password must be at least 6 characters")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.GetPassword()), bcrypt.DefaultCost)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	user := &model.User{
		ID:             uuid.New().String(),
		Email:          req.GetEmail(),
		Name:           req.GetName(),
		HashedPassword: string(hashed),
		CreatedAt:      time.Now(),
	}

	if err := s.repo.Create(ctx, user); err != nil {
		return nil, err
	}

	return &pb.RegisterResponse{UserId: user.ID}, nil
}

func (s *AuthService) Login(ctx context.Context, req *pb.LoginRequest) (*pb.LoginResponse, error) {
	if req.GetEmail() == "" || req.GetPassword() == "" {
		return nil, status.Error(codes.InvalidArgument, "email and password are required")
	}

	user, err := s.repo.FindByEmail(ctx, req.GetEmail())
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.HashedPassword), []byte(req.GetPassword())); err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid credentials")
	}

	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate access token")
	}

	refreshToken, err := s.tokens.GenerateRefreshToken(user.ID, user.Email)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate refresh token")
	}

	return &pb.LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	}, nil
}

func (s *AuthService) ValidateToken(_ context.Context, req *pb.ValidateTokenRequest) (*pb.ValidateTokenResponse, error) {
	if req.GetAccessToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "access_token is required")
	}

	claims, err := s.tokens.ValidateToken(req.GetAccessToken())
	if err != nil {
		return &pb.ValidateTokenResponse{Valid: false}, nil
	}

	if claims.TokenType != "access" {
		return &pb.ValidateTokenResponse{Valid: false}, nil
	}

	return &pb.ValidateTokenResponse{
		UserId: claims.Subject,
		Email:  claims.Email,
		Valid:  true,
	}, nil
}

func (s *AuthService) RefreshToken(_ context.Context, req *pb.RefreshTokenRequest) (*pb.RefreshTokenResponse, error) {
	if req.GetRefreshToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "refresh_token is required")
	}

	claims, err := s.tokens.ValidateToken(req.GetRefreshToken())
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid refresh token")
	}

	if claims.TokenType != "refresh" {
		return nil, status.Error(codes.Unauthenticated, "invalid token type")
	}

	accessToken, err := s.tokens.GenerateAccessToken(claims.Subject, claims.Email)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate access token")
	}

	refreshToken, err := s.tokens.GenerateRefreshToken(claims.Subject, claims.Email)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate refresh token")
	}

	return &pb.RefreshTokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	}, nil
}
