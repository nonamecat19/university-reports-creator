package service

import (
	"context"
	"encoding/json"
	"net/http"

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

func (s *AuthService) LoginWithGoogle(ctx context.Context, req *pb.LoginWithGoogleRequest) (*pb.LoginWithGoogleResponse, error) {
	if req.GetIdToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "id_token is required")
	}

	// Verify the Google ID token using Google's tokeninfo endpoint
	userData, err := s.verifyGoogleToken(ctx, req.GetIdToken())
	if err != nil {
		return nil, err
	}

	// Try to find existing user by email
	user, err := s.repo.FindByEmail(ctx, userData.Email)
	if err != nil {
		// User doesn't exist - create new user with Google provider
		hashed, _ := bcrypt.GenerateFromPassword([]byte(uuid.New().String()), bcrypt.DefaultCost)
		user = &model.User{
			ID:             uuid.New().String(),
			Email:          userData.Email,
			Name:           userData.Name,
			HashedPassword: string(hashed),
		}
		if err := s.repo.Create(ctx, user); err != nil {
			return nil, status.Error(codes.Internal, "failed to create user")
		}
	}

	// Generate our own tokens
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate access token")
	}

	refreshToken, err := s.tokens.GenerateRefreshToken(user.ID, user.Email)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate refresh token")
	}

	return &pb.LoginWithGoogleResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		UserId:       user.ID,
		Email:        user.Email,
		Name:         user.Name,
	}, nil
}

type googleTokenInfo struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	EmailVerified bool   `json:"email_verified"`
}

func (s *AuthService) verifyGoogleToken(ctx context.Context, idToken string) (*googleTokenInfo, error) {
	url := "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken

	resp, err := http.Get(url)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "failed to verify Google token")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, status.Error(codes.Unauthenticated, "invalid Google token")
	}

	var data googleTokenInfo
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, status.Error(codes.Unauthenticated, "failed to parse Google token")
	}

	if !data.EmailVerified {
		return nil, status.Error(codes.Unauthenticated, "email not verified with Google")
	}

	if data.Sub == "" {
		return nil, status.Error(codes.Unauthenticated, "invalid token - missing subject")
	}

	return &data, nil
}
