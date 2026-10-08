---
name: OpenAPI body schemas
description: Avoid duplicate exports when generating both Zod schemas and DTO types with Orval.
---

Use named component schemas referenced by request bodies instead of inline object body schemas.

**Why:** This workspace re-exports both generated Zod code and DTO types. Inline object bodies can make Orval generate the same operation-body type name in both outputs, causing duplicate-export TypeScript errors.

**How to apply:** Add the input object under components/schemas, reference it from the request body, then regenerate. Do not patch generated files or weaken the barrel exports.
