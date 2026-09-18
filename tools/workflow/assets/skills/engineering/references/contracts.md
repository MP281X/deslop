# Public Contracts

Changing type ownership must preserve field semantics. Trimming, coercion, defaults, brands, or stricter validation require a current boundary requirement.

Represent invalid states in the Schema so internal code receives the narrowest truthful type. Prefer Schema-backed structures, brands, and tagged errors over parallel custom types. Infer local implementation types instead of publishing internal contracts.

Decisions that require current authoritative state, such as authorization or resource existence, remain domain operations rather than input validation.
