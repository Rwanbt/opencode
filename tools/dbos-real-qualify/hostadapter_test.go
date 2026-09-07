package main

import (
	"testing"
)

// Frozen FC-31B vectors (packages/automate-m0-contract/src/vectors.ts,
// M0_UNIFIAVALUE_VECTOR_V1 filtered to test == "FC-31B") plus the
// master-plan §22 required extremes. Each verdict records the actual Go
// type the host materialized.
func TestCanonize_FrozenFC31BVectors(t *testing.T) {
	cases := []struct {
		name         string
		encoding     string
		payload      string
		wantOutcome  string
		wantCode     string
		wantGoType   string
	}{
		// HOST_INTEGER_CASES
		{"fc31b-integer-max-safe", "host-integer", "9007199254740991", "pass", "", "int64"},
		{"fc31b-integer-min-safe", "host-integer", "-9007199254740991", "pass", "", "int64"},
		{"fc31b-integer-two-pow-53", "host-integer", "9007199254740992", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "int64"},
		{"fc31b-integer-negative-two-pow-53", "host-integer", "-9007199254740992", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "int64"},
		{"fc31b-int64-max", "host-bigint", "9223372036854775807", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "int64"},
		{"fc31b-int64-min", "host-bigint", "-9223372036854775808", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "int64"},
		{"fc31b-bigint-outside-safe", "host-bigint", "9007199254740993", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "int64"},
		{"fc31b-float64-two-pow-53", "float64-decimal", "9007199254740992", "pass", "", "float64"},
		// §22 required extremes
		{"max-uint64", "host-bigint", "18446744073709551615", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "uint64"},
		{"max-int64", "host-bigint", "9223372036854775807", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "int64"},
		{"min-int64", "host-bigint", "-9223372036854775808", "reject", "NUMBER_OUT_OF_CANONICAL_RANGE", "int64"},
		// TIME_CASES
		{"fc31b-ts-epoch", "canonical-timestamp", "0", "pass", "", "time.Time"},
		{"fc31b-ts-negative-day", "canonical-timestamp", "-86400000", "pass", "", "time.Time"},
		{"fc31b-ts-2023", "canonical-timestamp", "1672531200000", "pass", "", "time.Time"},
		{"fc31b-host-date-in-typed-field", "host-date", "1672531200000", "pass", "", "time.Time"},
		{"fc31b-host-date-untyped", "host-sentinel", "date", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
		// HOST_SENTINEL_CASES
		{"fc31b-undefined", "host-sentinel", "undefined", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
		{"fc31b-function", "host-sentinel", "function", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
		{"fc31b-symbol", "host-sentinel", "symbol", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
		{"fc31b-map", "host-sentinel", "map", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
		{"fc31b-set", "host-sentinel", "set", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
		{"fc31b-binary", "host-sentinel", "binary", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
		{"fc31b-class-instance", "host-sentinel", "class-instance", "reject", "UNSUPPORTED_HOST_TYPE", "unsupported"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := canonize(tc.encoding, tc.payload)
			if got.Outcome != tc.wantOutcome {
				t.Fatalf("outcome = %q, want %q (verdict %+v)", got.Outcome, tc.wantOutcome, got)
			}
			if got.Code != tc.wantCode {
				t.Fatalf("code = %q, want %q", got.Code, tc.wantCode)
			}
			if got.GoType != tc.wantGoType {
				t.Fatalf("goType = %q, want %q", got.GoType, tc.wantGoType)
			}
			if tc.wantOutcome == "pass" && got.Canonical == nil {
				t.Fatalf("pass verdict without canonical materialization: %+v", got)
			}
		})
	}
}

// The deliberate §27 contrast: same decimal, opposite verdicts depending on
// the host promise (integer exactness vs already-canonical binary64).
func TestCanonize_IntegerFloat64Contrast(t *testing.T) {
	asInteger := canonize("host-integer", "9007199254740992")
	if asInteger.Outcome != "reject" || asInteger.Code != "NUMBER_OUT_OF_CANONICAL_RANGE" {
		t.Fatalf("int64 2^53 must reject, got %+v", asInteger)
	}
	asFloat := canonize("float64-decimal", "9007199254740992")
	if asFloat.Outcome != "pass" {
		t.Fatalf("float64 2^53 must pass, got %+v", asFloat)
	}
	if asFloat.Canonical.Bits != "4340000000000000" {
		t.Fatalf("float64 2^53 bits = %q, want 4340000000000000", asFloat.Canonical.Bits)
	}
}

// -0 normalizes to +0 under the float64 entry (§26).
func TestCanonize_NegativeZeroNormalizes(t *testing.T) {
	got := canonize("float64-decimal", "-0")
	if got.Outcome != "pass" {
		t.Fatalf("-0 must pass, got %+v", got)
	}
	if got.Canonical.Bits != "0000000000000000" {
		t.Fatalf("-0 bits = %q, want 0000000000000000 (+0)", got.Canonical.Bits)
	}
}