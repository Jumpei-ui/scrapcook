---
name: Private usage policy
description: Owner-only visibility, counting semantics, retention, reset safety, and the daily boundary.
---

Keep the usage page unlinked from the public app and return 404 for unauthorized access.

**Why:** The user explicitly requested a private owner-only page that normal users cannot discover through navigation.

**How to apply:** Protect the HTML, usage data, and reset operation on the server. Do not expose counts or IP history through normal recipe responses.

Count actual provider-call attempts, including retries; cached generation requests must not increase provider counters.

**Why:** A generation request can use either provider, both providers several times, or neither when cached. Incrementing both once per generation would misrepresent usage. Calls are not equivalent to billed credits.

**How to apply:** Keep provider-call accounting separate from recipe-request totals and label the distinction honestly.

Reset display counters without resetting protective rate limits or spending caps.

**Why:** Resetting an owner's reporting view must not reopen the budget for public requests or imply that provider quotas have been restored.

**How to apply:** Keep reporting and enforcement state separate and retain the reset confirmation.

Use Brisbane midnight for the daily reporting boundary and retain only today's last 20 request IPs.

**Why:** Daily reporting needs a consistent server-side boundary, and the requested IP history is a small private list rather than a permanent visitor archive.

**How to apply:** Keep raw IP history backend-only and bounded; never copy it into agent memory or public logs.
