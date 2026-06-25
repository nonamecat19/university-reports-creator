package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/nnc/university-reports-creator/service-auth/internal/db"
	"github.com/nnc/university-reports-creator/service-auth/internal/model"
)

type RefreshTokenRepository interface {
	Create(ctx context.Context, rt *model.RefreshToken) error
	FindByHash(ctx context.Context, hash string) (*model.RefreshToken, error)
	Revoke(ctx context.Context, id string) error
	RevokeFamily(ctx context.Context, familyID string) error
}

type refreshTokenRepo struct {
	q *db.Queries
}

func NewRefreshTokenRepository(conn *sql.DB) RefreshTokenRepository {
	return &refreshTokenRepo{q: db.New(conn)}
}

func (r *refreshTokenRepo) Create(ctx context.Context, rt *model.RefreshToken) error {
	id, err := uuid.Parse(rt.ID)
	if err != nil {
		return status.Errorf(codes.Internal, "invalid refresh token id: %v", err)
	}
	userID, err := uuid.Parse(rt.UserID)
	if err != nil {
		return status.Errorf(codes.Internal, "invalid user id: %v", err)
	}
	familyID, err := uuid.Parse(rt.FamilyID)
	if err != nil {
		return status.Errorf(codes.Internal, "invalid family id: %v", err)
	}

	if err := r.q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		ID:        id,
		UserID:    userID,
		TokenHash: rt.TokenHash,
		FamilyID:  familyID,
		ExpiresAt: rt.ExpiresAt,
		CreatedAt: rt.CreatedAt,
	}); err != nil {
		return status.Errorf(codes.Internal, "failed to create refresh token: %v", err)
	}
	return nil
}

func (r *refreshTokenRepo) FindByHash(ctx context.Context, hash string) (*model.RefreshToken, error) {
	rt, err := r.q.FindRefreshTokenByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, status.Error(codes.Unauthenticated, "invalid refresh token")
		}
		return nil, status.Errorf(codes.Internal, "failed to find refresh token: %v", err)
	}
	var revokedAt *time.Time
	if rt.RevokedAt.Valid {
		revokedAt = &rt.RevokedAt.Time
	}
	return &model.RefreshToken{
		ID:        rt.ID.String(),
		UserID:    rt.UserID.String(),
		TokenHash: rt.TokenHash,
		FamilyID:  rt.FamilyID.String(),
		ExpiresAt: rt.ExpiresAt,
		RevokedAt: revokedAt,
		CreatedAt: rt.CreatedAt,
	}, nil
}

func (r *refreshTokenRepo) Revoke(ctx context.Context, id string) error {
	rid, err := uuid.Parse(id)
	if err != nil {
		return status.Errorf(codes.Internal, "invalid refresh token id: %v", err)
	}
	if err := r.q.RevokeRefreshToken(ctx, rid); err != nil {
		return status.Errorf(codes.Internal, "failed to revoke refresh token: %v", err)
	}
	return nil
}

func (r *refreshTokenRepo) RevokeFamily(ctx context.Context, familyID string) error {
	fid, err := uuid.Parse(familyID)
	if err != nil {
		return status.Errorf(codes.Internal, "invalid family id: %v", err)
	}
	if err := r.q.RevokeRefreshTokenFamily(ctx, fid); err != nil {
		return status.Errorf(codes.Internal, "failed to revoke refresh token family: %v", err)
	}
	return nil
}
