package service

import "encoding/json"

// Mirrors the JSON shape service-render's ParseTemplate produces (FR-TPL-08).
// Only the fields CreateDocument needs to instantiate sections/metadata are
// modeled here — the rest of the model rides through opaquely as ModelJson.
type templateModelField struct {
	Name    string `json:"name"`
	Default string `json:"default"`
}

type templateModelSection struct {
	ID             string         `json:"id"`
	Label          string         `json:"label"`
	Order          int            `json:"order"`
	Required       bool           `json:"required"`
	Kind           string         `json:"kind"`
	ExampleContent map[string]any `json:"example_content"`
}

type templateModel struct {
	Fields   []templateModelField   `json:"fields"`
	Sections []templateModelSection `json:"sections"`
}

func parseTemplateModel(raw map[string]any) (*templateModel, error) {
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var m templateModel
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func defaultsFromFields(fields []templateModelField) map[string]string {
	out := map[string]string{}
	for _, f := range fields {
		if f.Default != "" {
			out[f.Name] = f.Default
		}
	}
	return out
}
