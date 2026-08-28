# The release gate did not prove the user outcome

Summary: source, package, and Lens fixture checks proved the append-only infrastructure but never proved that `model-catalog-and-routing` could be remediated by the published runtime.

Severity: high

Affected files: `package.json`; package projection checks; cross-repository conformance checks; release documentation.

Reproduction: Kyro 4.43.5 and its installed runtime match, yet Doctor rejects the real live debt and no supported manifest can produce a valid post-state.

Expected behavior: publication is blocked until a faithful before/prepare/preview/apply/Doctor/recertify/Lens scenario passes through an isolated package and projected runtime with historical hashes unchanged.

Recommendation: make the motivating artifact shape a mandatory aggregate release gate and document the 4.43.5 limitation.
