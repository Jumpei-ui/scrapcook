---
name: Scoped session testing
description: Flask test session transactions must respect the API session cookie's path.
---

Flask's test client applies cookie path scoping to session transactions as well as HTTP requests. A transaction using the default root path can inspect a different, empty session from the API request.

**Why:** A successful recipe response appeared to lose its session state because the test inspected the root path rather than the API cookie's scope; the application itself retained the session correctly.

**How to apply:** Use a session transaction path within the API's cookie scope when setting up or inspecting backend test sessions.
