package repository

import (
	"context"
	"fmt"

	surrealdb "github.com/surrealdb/surrealdb.go"
)

// schemaDefinitions are idempotent DEFINE statements (FR-DAT-05): SCHEMAFULL
// shapes for the stable columns, FLEXIBLE objects for the dynamic ones
// (metadata/settings/content/model) so ProseMirror JSON and the parsed
// TemplateModel are not mirrored in the schema.
const schemaDefinitions = `
DEFINE TABLE IF NOT EXISTS template SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS owner_id ON template TYPE string;
DEFINE FIELD IF NOT EXISTS name ON template TYPE string;
DEFINE FIELD IF NOT EXISTS description ON template TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS report_type ON template TYPE string;
DEFINE FIELD IF NOT EXISTS visibility ON template TYPE string DEFAULT 'private';
DEFINE FIELD IF NOT EXISTS current_version ON template TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS created_at ON template TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON template TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_template_owner ON template FIELDS owner_id;

DEFINE TABLE IF NOT EXISTS template_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS template_id ON template_version TYPE string;
DEFINE FIELD IF NOT EXISTS version ON template_version TYPE int;
DEFINE FIELD IF NOT EXISTS file_key ON template_version TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS model ON template_version TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS warnings ON template_version TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS confirmed ON template_version TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS created_at ON template_version TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_template_version_template ON template_version FIELDS template_id;

DEFINE TABLE IF NOT EXISTS document SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS owner_id ON document TYPE string;
DEFINE FIELD IF NOT EXISTS template_id ON document TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS template_version ON document TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS title ON document TYPE string;
DEFINE FIELD IF NOT EXISTS metadata ON document TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS settings ON document TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS metadata_revision ON document TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS created_at ON document TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON document TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_document_owner ON document FIELDS owner_id;

DEFINE TABLE IF NOT EXISTS section SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS document_id ON section TYPE string;
DEFINE FIELD IF NOT EXISTS template_section_id ON section TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS title ON section TYPE string;
DEFINE FIELD IF NOT EXISTS kind ON section TYPE string DEFAULT 'chapter';
DEFINE FIELD IF NOT EXISTS order_index ON section TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS required ON section TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS revision ON section TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS content ON section TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS updated_at ON section TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_section_document ON section FIELDS document_id;

DEFINE TABLE IF NOT EXISTS export_job SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS document_id ON export_job TYPE string;
DEFINE FIELD IF NOT EXISTS snapshot_id ON export_job TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS requested_by ON export_job TYPE string;
DEFINE FIELD IF NOT EXISTS options ON export_job TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS status ON export_job TYPE string DEFAULT 'queued';
DEFINE FIELD IF NOT EXISTS stage ON export_job TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS warnings ON export_job TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS artifacts ON export_job TYPE array DEFAULT [];
DEFINE FIELD IF NOT EXISTS artifacts.* ON export_job TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS error ON export_job TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS created_at ON export_job TYPE datetime;
DEFINE FIELD IF NOT EXISTS finished_at ON export_job TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS idx_export_job_document ON export_job FIELDS document_id;

DEFINE TABLE IF NOT EXISTS source SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS document_id ON source TYPE string;
DEFINE FIELD IF NOT EXISTS csl ON source TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS language ON source TYPE string DEFAULT 'uk';
DEFINE FIELD IF NOT EXISTS raw_input ON source TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS fill_status ON source TYPE string DEFAULT 'manual';
DEFINE FIELD IF NOT EXISTS access_date ON source TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS include_uncited_override ON source TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS created_at ON source TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_source_document ON source FIELDS document_id;

DEFINE TABLE IF NOT EXISTS snapshot SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS document_id ON snapshot TYPE string;
DEFINE FIELD IF NOT EXISTS name ON snapshot TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS trigger ON snapshot TYPE string DEFAULT 'manual';
DEFINE FIELD IF NOT EXISTS data ON snapshot TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS created_at ON snapshot TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_snapshot_document ON snapshot FIELDS document_id;
`

// ApplySchema applies the DEFINE statements above. Safe to run on every
// startup: every DEFINE uses IF NOT EXISTS.
func ApplySchema(ctx context.Context, db *surrealdb.DB) error {
	_, err := surrealdb.Query[any](ctx, db, schemaDefinitions, nil)
	if err != nil {
		return fmt.Errorf("apply surrealdb schema: %w", err)
	}
	return nil
}
