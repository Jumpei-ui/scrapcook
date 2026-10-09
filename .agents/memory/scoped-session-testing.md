---
name: Protected session testing
description: Cookie path traps and browser-runtime credential boundaries when verifying protected pages.
---

Flask's test client applies cookie path scoping to session transactions as well as HTTP requests. A transaction using the default root path can inspect a different, empty session from the API request.

**Why:** A successful recipe response appeared to lose its session state because the test inspected the root path rather than the API cookie's scope; the application itself retained the session correctly.

**How to apply:** Use a session transaction path within the API's cookie scope when setting up or inspecting backend test sessions.

The Playwright browser-script sandbox may lack Node's process and environment variables even when the server has configured Secrets.

**Why:** An admin authentication attempt failed before sending a request because process was undefined in the browser-script runtime.

**How to apply:** Keep credential use inside a runtime-backed authentication request without printing or retrieving values into agent context. If safe browser credential transfer is unavailable, verify live backend authentication separately and test a credential-stripped copy of the authenticated HTML with fixture responses. Report that boundary honestly; never dump secrets or session cookies as a workaround.
