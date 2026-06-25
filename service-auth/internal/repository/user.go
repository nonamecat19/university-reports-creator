package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/nnc/university-reports-creator/service-auth/internal/db"
	"github.com/nnc/university-reports-creator/service-auth/internal/model"
)

type UserRepository interface {
	Create(ctx context.Context, user *model.User) error
	FindByEmail(ctx context.Context, email string) (*model.User, error)
	FindByID(ctx context.Context, id string) (*model.User, error)
	FindByGoogleSub(ctx context.Context, sub string) (*model.User, error)
	UpdateProfile(ctx context.Context, user *model.User) (*model.User, error)
}

type userRepo struct {
	q *db.Queries
}

func NewUserRepository(conn *sql.DB) UserRepository {
	return &userRepo{q: db.New(conn)}
}

func (r *userRepo) Create(ctx context.Context, user *model.User) error {
	id, err := uuid.Parse(user.ID)
	if err != nil {
		return status.Errorf(codes.Internal, "invalid user id: %v", err)
	}

	err = r.q.CreateUser(ctx, db.CreateUserParams{
		ID:             id,
		Email:          user.Email,
		Name:           user.Name,
		HashedPassword: nullString(user.HashedPassword),
		GoogleSub:      nullString(user.GoogleSub),
		CreatedAt:      user.CreatedAt,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return status.Errorf(codes.AlreadyExists, "user with email %q already exists", user.Email)
		}
		return status.Errorf(codes.Internal, "failed to create user: %v", err)
	}
	return nil
}

func (r *userRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	u, err := r.q.FindUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, status.Errorf(codes.NotFound, "user with email %q not found", email)
		}
		return nil, status.Errorf(codes.Internal, "failed to find user: %v", err)
	}
	return &model.User{
		ID:             u.ID.String(),
		Email:          u.Email,
		Name:           u.Name,
		HashedPassword: u.HashedPassword.String,
		GoogleSub:      u.GoogleSub.String,
		EmailVerified:  u.EmailVerified,
		University:     u.University.String,
		Faculty:        u.Faculty.String,
		Department:     u.Department.String,
		StudentGroup:   u.StudentGroup.String,
		Supervisor:     u.Supervisor.String,
		CreatedAt:      u.CreatedAt,
		UpdatedAt:      u.UpdatedAt,
	}, nil
}

func (r *userRepo) FindByID(ctx context.Context, id string) (*model.User, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user id: %v", err)
	}

	u, err := r.q.FindUserByID(ctx, uid)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, status.Errorf(codes.NotFound, "user with id %q not found", id)
		}
		return nil, status.Errorf(codes.Internal, "failed to find user: %v", err)
	}
	return &model.User{
		ID:             u.ID.String(),
		Email:          u.Email,
		Name:           u.Name,
		HashedPassword: u.HashedPassword.String,
		GoogleSub:      u.GoogleSub.String,
		EmailVerified:  u.EmailVerified,
		University:     u.University.String,
		Faculty:        u.Faculty.String,
		Department:     u.Department.String,
		StudentGroup:   u.StudentGroup.String,
		Supervisor:     u.Supervisor.String,
		CreatedAt:      u.CreatedAt,
		UpdatedAt:      u.UpdatedAt,
	}, nil
}

func (r *userRepo) FindByGoogleSub(ctx context.Context, sub string) (*model.User, error) {
	u, err := r.q.FindUserByGoogleSub(ctx, nullString(sub))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, status.Errorf(codes.NotFound, "user with google_sub %q not found", sub)
		}
		return nil, status.Errorf(codes.Internal, "failed to find user: %v", err)
	}
	return &model.User{
		ID:             u.ID.String(),
		Email:          u.Email,
		Name:           u.Name,
		HashedPassword: u.HashedPassword.String,
		GoogleSub:      u.GoogleSub.String,
		EmailVerified:  u.EmailVerified,
		University:     u.University.String,
		Faculty:        u.Faculty.String,
		Department:     u.Department.String,
		StudentGroup:   u.StudentGroup.String,
		Supervisor:     u.Supervisor.String,
		CreatedAt:      u.CreatedAt,
		UpdatedAt:      u.UpdatedAt,
	}, nil
}

func (r *userRepo) UpdateProfile(ctx context.Context, user *model.User) (*model.User, error) {
	id, err := uuid.Parse(user.ID)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user id: %v", err)
	}

	u, err := r.q.UpdateUserProfile(ctx, db.UpdateUserProfileParams{
		ID:           id,
		Name:         user.Name,
		University:   nullString(user.University),
		Faculty:      nullString(user.Faculty),
		Department:   nullString(user.Department),
		StudentGroup: nullString(user.StudentGroup),
		Supervisor:   nullString(user.Supervisor),
		UpdatedAt:    time.Now(),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, status.Errorf(codes.NotFound, "user with id %q not found", user.ID)
		}
		return nil, status.Errorf(codes.Internal, "failed to update profile: %v", err)
	}
	return &model.User{
		ID:             u.ID.String(),
		Email:          u.Email,
		Name:           u.Name,
		HashedPassword: u.HashedPassword.String,
		GoogleSub:      u.GoogleSub.String,
		EmailVerified:  u.EmailVerified,
		University:     u.University.String,
		Faculty:        u.Faculty.String,
		Department:     u.Department.String,
		StudentGroup:   u.StudentGroup.String,
		Supervisor:     u.Supervisor.String,
		CreatedAt:      u.CreatedAt,
		UpdatedAt:      u.UpdatedAt,
	}, nil
}

func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "duplicate key value violates unique constraint")
}
