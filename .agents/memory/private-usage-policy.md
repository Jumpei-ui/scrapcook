---
name: Private usage policy
description: Owner-only visibility, counting semantics, retention, reset safety, and the daily boundary.
---

Keep the usage page unlinked from the public app and return 404 for unauthorized access.

**Why:** The user explicitly requested a private owner-only page that normal users cannot discover through navigation.

**How to apply:** Protect the HTML, usage data, and reset operation on the server. Do not expose counts or IP history through normal recipe responses, including shared-usage response headers.

Count actual provider-call attempts, including retries; cached generation requests must not increase provider counters.

**Why:** A generation request can use either provider, both providers several times, or neither when cached. Incrementing both once per generation would misrepresent usage. Calls are not equivalent to billed credits.

**How to apply:** Keep provider-call accounting separate from recipe-request totals and label the distinction honestly.

Reset display counters without resetting protective rate limits or spending caps.

**Why:** Resetting an owner's reporting view must not reopen the budget for public requests or imply that provider quotas have been restored.

**How to apply:** Keep reporting and enforcement state separate and retain the reset confirmation.

Use midnight UTC for daily reporting and automatic spending pauses; retain only today's last 20 request IPs.

**Why:** The user explicitly requested midnight UTC resets for auto-pause. Owner reporting should match that boundary, and IP history is a small private list rather than a permanent visitor archive.

**How to apply:** Do not switch the budget day back to the browser's or owner's local timezone. Keep raw IP history backend-only and bounded; never copy it into agent memory or public logs.

Only authenticated owners may Force Resume after explicitly accepting possible charges; the exception expires at midnight UTC.

**Why:** The user requested automatic pausing at the Spoonacular limit and a deliberate owner-only way to accept additional costs. Reporting resets are not that consent.

**How to apply:** Keep acceptance explicit and CSRF-protected. Preserve other protective request limits. Call counts are not Spoonacular billing points, so never promise a zero-charge guarantee from a call-count ceiling.
