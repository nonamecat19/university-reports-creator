package service

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/nnc/university-reports-creator/gen/go/auth"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcmeta"
	"github.com/nnc/university-reports-creator/service-auth/internal/model"
	"github.com/nnc/university-reports-creator/service-auth/internal/repository"
	"github.com/nnc/university-reports-creator/service-auth/internal/token"
)

var emailRE = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type AuthService struct {
	pb.UnimplementedAuthServiceServer
	repo                 repository.UserRepository
	refreshRepo          repository.RefreshTokenRepository
	tokens               *token.JWTManager
	refreshTokenDuration time.Duration
}

func NewAuthService(repo repository.UserRepository, refreshRepo repository.RefreshTokenRepository, tokens *token.JWTManager, refreshTokenDuration time.Duration) *AuthService {
	return &AuthService{
		repo:                 repo,
		refreshRepo:          refreshRepo,
		tokens:               tokens,
		refreshTokenDuration: refreshTokenDuration,
	}
}

func (s *AuthService) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	if !emailRE.MatchString(req.GetEmail()) {
		return nil, status.Error(codes.InvalidArgument, "invalid email format")
	}
	if len(req.GetPassword()) < 8 {
		return nil, status.Error(codes.InvalidArgument, "password must be at least 8 characters")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.GetPassword()), bcrypt.DefaultCost)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	now := time.Now()
	user := &model.User{
		ID:             uuid.New().String(),
		Email:          req.GetEmail(),
		Name:           req.GetName(),
		HashedPassword: string(hashed),
		CreatedAt:      now,
		UpdatedAt:      now,
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

	if !user.HasPassword() {
		return nil, status.Error(codes.Unauthenticated, "invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.HashedPassword), []byte(req.GetPassword())); err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid credentials")
	}

	return s.issueTokenPair(ctx, user, "")
}

func (s *AuthService) ValidateToken(_ context.Context, req *pb.ValidateTokenRequest) (*pb.ValidateTokenResponse, error) {
	if req.GetAccessToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "access_token is required")
	}

	claims, err := s.tokens.ValidateToken(req.GetAccessToken())
	if err != nil {
		return &pb.ValidateTokenResponse{Valid: false}, nil
	}

	return &pb.ValidateTokenResponse{
		UserId: claims.Subject,
		Email:  claims.Email,
		Valid:  true,
	}, nil
}

// RefreshToken rotates the refresh token: the presented token is revoked and a
// new pair issued (FR-AUTH-02). Reuse of an already-revoked token revokes the
// whole rotation family (theft defense).
func (s *AuthService) RefreshToken(ctx context.Context, req *pb.RefreshTokenRequest) (*pb.RefreshTokenResponse, error) {
	if req.GetRefreshToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "refresh_token is required")
	}

	hash := token.HashRefreshToken(req.GetRefreshToken())
	rt, err := s.refreshRepo.FindByHash(ctx, hash)
	if err != nil {
		return nil, err
	}

	if rt.Revoked() {
		_ = s.refreshRepo.RevokeFamily(ctx, rt.FamilyID)
		return nil, status.Error(codes.Unauthenticated, "refresh token reuse detected")
	}
	if rt.Expired(time.Now()) {
		return nil, status.Error(codes.Unauthenticated, "refresh token expired")
	}

	user, err := s.repo.FindByID(ctx, rt.UserID)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid refresh token")
	}

	if err := s.refreshRepo.Revoke(ctx, rt.ID); err != nil {
		return nil, err
	}

	resp, err := s.issueTokenPair(ctx, user, rt.FamilyID)
	if err != nil {
		return nil, err
	}
	return &pb.RefreshTokenResponse{
		AccessToken:  resp.AccessToken,
		RefreshToken: resp.RefreshToken,
	}, nil
}

func (s *AuthService) Logout(ctx context.Context, req *pb.LogoutRequest) (*pb.LogoutResponse, error) {
	if req.GetRefreshToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "refresh_token is required")
	}
	hash := token.HashRefreshToken(req.GetRefreshToken())
	rt, err := s.refreshRepo.FindByHash(ctx, hash)
	if err != nil {
		// Already gone/invalid: logout is idempotent from the client's perspective.
		return &pb.LogoutResponse{}, nil
	}
	if err := s.refreshRepo.Revoke(ctx, rt.ID); err != nil {
		return nil, err
	}
	return &pb.LogoutResponse{}, nil
}

func (s *AuthService) GetProfile(ctx context.Context, _ *pb.GetProfileRequest) (*pb.ProfileResponse, error) {
	userID := grpcmeta.UserID(ctx)
	if userID == "" {
		return nil, status.Error(codes.Unauthenticated, "authentication required")
	}
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &pb.ProfileResponse{Profile: toProfilePb(user)}, nil
}

func (s *AuthService) UpdateProfile(ctx context.Context, req *pb.UpdateProfileRequest) (*pb.ProfileResponse, error) {
	userID := grpcmeta.UserID(ctx)
	if userID == "" {
		return nil, status.Error(codes.Unauthenticated, "authentication required")
	}
	updated, err := s.repo.UpdateProfile(ctx, &model.User{
		ID:           userID,
		Name:         req.GetName(),
		University:   req.GetUniversity(),
		Faculty:      req.GetFaculty(),
		Department:   req.GetDepartment(),
		StudentGroup: req.GetStudentGroup(),
		Supervisor:   req.GetSupervisor(),
	})
	if err != nil {
		return nil, err
	}
	return &pb.ProfileResponse{Profile: toProfilePb(updated)}, nil
}

func (s *AuthService) LoginWithGoogle(ctx context.Context, req *pb.LoginWithGoogleRequest) (*pb.LoginWithGoogleResponse, error) {
	if req.GetIdToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "id_token is required")
	}

	userData, err := s.verifyGoogleToken(ctx, req.GetIdToken())
	if err != nil {
		return nil, err
	}

	user, err := s.repo.FindByGoogleSub(ctx, userData.Sub)
	if err != nil {
		// Not linked yet: reuse an existing email account or create a new one.
		user, err = s.repo.FindByEmail(ctx, userData.Email)
		if err != nil {
			now := time.Now()
			user = &model.User{
				ID:            uuid.New().String(),
				Email:         userData.Email,
				Name:          userData.Name,
				GoogleSub:     userData.Sub,
				EmailVerified: true,
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if err := s.repo.Create(ctx, user); err != nil {
				return nil, status.Error(codes.Internal, "failed to create user")
			}
		}
	}

	resp, err := s.issueTokenPair(ctx, user, "")
	if err != nil {
		return nil, err
	}

	return &pb.LoginWithGoogleResponse{
		AccessToken:  resp.AccessToken,
		RefreshToken: resp.RefreshToken,
		UserId:       user.ID,
		Email:        user.Email,
		Name:         user.Name,
	}, nil
}

// issueTokenPair mints an access token and a fresh refresh token record. When
// familyID is empty a new rotation family starts (login); otherwise the new
// token continues the existing family (refresh).
func (s *AuthService) issueTokenPair(ctx context.Context, user *model.User, familyID string) (*pb.LoginResponse, error) {
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate access token")
	}

	raw, hash, err := token.GenerateRefreshToken()
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate refresh token")
	}
	if familyID == "" {
		familyID = uuid.New().String()
	}

	now := time.Now()
	if err := s.refreshRepo.Create(ctx, &model.RefreshToken{
		ID:        uuid.New().String(),
		UserID:    user.ID,
		TokenHash: hash,
		FamilyID:  familyID,
		ExpiresAt: now.Add(s.refreshTokenDuration),
		CreatedAt: now,
	}); err != nil {
		return nil, err
	}

	return &pb.LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: raw,
	}, nil
}

func toProfilePb(u *model.User) *pb.Profile {
	return &pb.Profile{
		UserId:       u.ID,
		Email:        u.Email,
		Name:         u.Name,
		University:   u.University,
		Faculty:      u.Faculty,
		Department:   u.Department,
		StudentGroup: u.StudentGroup,
		Supervisor:   u.Supervisor,
	}
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

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to build Google verification request")
	}
	resp, err := http.DefaultClient.Do(httpReq)
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
