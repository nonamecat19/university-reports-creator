package repository

import (
	"fmt"

	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// idHydrator lets single/rows populate a plain-string ID field after decode.
// The driver's CBOR decoder only writes record-id tags into a models.RecordID
// field, never into a plain string (see decodeRecordIDTag): every entity
// keeps its raw models.RecordID (tag `id`) alongside a derived string ID that
// callers actually use.
type idHydrator interface {
	hydrateID()
}

func idString(r models.RecordID) string {
	s, _ := r.ID.(string)
	return s
}

// single unwraps the first row of the first statement in a query result, or
// nil if the statement matched nothing.
func single[T any](res *[]surrealdb.QueryResult[[]T]) (*T, error) {
	if res == nil || len(*res) == 0 {
		return nil, fmt.Errorf("empty query result")
	}
	stmt := (*res)[0]
	if stmt.Error != nil {
		return nil, stmt.Error
	}
	if len(stmt.Result) == 0 {
		return nil, nil
	}
	row := stmt.Result[0]
	if h, ok := any(&row).(idHydrator); ok {
		h.hydrateID()
	}
	return &row, nil
}

// rows unwraps every row of the first statement in a query result.
func rows[T any](res *[]surrealdb.QueryResult[[]T]) ([]T, error) {
	if res == nil || len(*res) == 0 {
		return nil, fmt.Errorf("empty query result")
	}
	stmt := (*res)[0]
	if stmt.Error != nil {
		return nil, stmt.Error
	}
	for i := range stmt.Result {
		if h, ok := any(&stmt.Result[i]).(idHydrator); ok {
			h.hydrateID()
		}
	}
	return stmt.Result, nil
}

type countRow struct {
	Count int `json:"count"`
}

func countFrom(res *[]surrealdb.QueryResult[[]countRow]) int {
	if res == nil || len(*res) == 0 {
		return 0
	}
	stmt := (*res)[0]
	if len(stmt.Result) == 0 {
		return 0
	}
	return stmt.Result[0].Count
}
