package service

import "testing"

// FR-AI-09: identity is section + category + text. Whitespace differences in
// how a model formats the same message must not create a second comment.
func TestAiFindingKeyIgnoresWhitespaceFormatting(t *testing.T) {
	a := aiFindingKey("s1", "structure", "Вступ не містить мети\n  дослідження.")
	b := aiFindingKey("s1", "structure", "Вступ не містить мети дослідження.")
	if a != b {
		t.Fatalf("reformatted message produced a different key:\n%q\n%q", a, b)
	}
}

func TestAiFindingKeySeparatesFields(t *testing.T) {
	// Without a separator these two would collide: "s1"+"a" == "s"+"1a".
	if aiFindingKey("s1", "a", "x") == aiFindingKey("s", "1a", "x") {
		t.Fatal("keys from different section/category splits collided")
	}
	if aiFindingKey("s1", "structure", "x") == aiFindingKey("s1", "coherence", "x") {
		t.Fatal("category is not part of the key")
	}
	if aiFindingKey("s1", "structure", "x") == aiFindingKey("s2", "structure", "x") {
		t.Fatal("section is not part of the key")
	}
}
