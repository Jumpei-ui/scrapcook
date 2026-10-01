---
name: Python API child process
description: Runtime working-directory behavior for the Python service spawned by the API artifact.
---

Resolve the Python executable from the workspace root, not from the API artifact workflow's current working directory. The workflow starts in `artifacts/api-server`, while the installed Replit Python environment is in the workspace-level `.pythonlibs` directory.

**Why:** A valid interpreter path relative to the workspace appeared missing when the API process resolved it relative to its package directory.

**How to apply:** When the Node API server spawns Python, derive the service and workspace roots from the running module location, then set the child process working directory to the workspace root.