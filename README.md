# Smartboard

For the installable phone app and remote setup, see [Android APK and free backend hosting](docs/android-and-hosting.md). The Render Blueprint is [render.yaml](render.yaml).

A first vertical slice of the SRS: create a board, write text and an equation, select content, review structured context, ask a contextual question, stream the answer, and restore the board and conversation.

The backend is entirely Python, per the requested architecture change. The frontend uses Next.js, TypeScript, React and Konva. FastAPI owns board management, selection and AI orchestration in separate modules within one process. SQLAlchemy uses a persistent SQLite database locally and supports PostgreSQL through `DATABASE_URL`.

## Run locally

Prerequisites: Node.js 22.18+ or 24+, and Python 3.12+. This implementation was checked with Node 24 and Python 3.12.

From the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services/api/requirements-dev.txt
npm.cmd --prefix apps/web install
Copy-Item .env.example services/api/.env
npm.cmd run dev
```

On macOS/Linux, use `.venv/bin/python` and `npm` in place of the Windows commands. The launcher chooses the workspace virtual environment automatically; `SMARTBOARD_PYTHON` can override it.

Open **http://127.0.0.1:3000**. The API runs on port 8000; interactive OpenAPI documentation is at **http://127.0.0.1:8000/docs**. Both processes bind to loopback. Stop them with Ctrl+C. No Docker, Java, cloud resources or API key are needed for the default demo.

The first visit creates a physics example. Click **Try it**, review the selected equation and nearby heading, then choose **Explain simply**. Ask a follow-up or request an example. Refresh to restore the saved selection and its conversation. Create a blank board with **New board**.

## Live OpenAI responses

Edit `services/api/.env`, then restart the API:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

The model is configurable. The provider implements the [Responses API streaming contract](https://developers.openai.com/api/docs/guides/streaming-responses), disables provider storage with `store=false`, and records actual token counts from completed response events. API keys stay on the Python server. No live provider request is made in demo mode, and provider failures never fall back silently to demo content. Demo replies are scripted and explicitly labeled in both the UI and response text.

Optional `INPUT_USD_PER_MILLION` and `OUTPUT_USD_PER_MILLION` values enable estimated cost accounting for the configured model. Without explicit prices, cost remains `null`. Demo token counts also remain `null`.

## What works

- Text, plain text/Unicode equations, freehand pen strokes, labeled shapes, object erasing, object movement, undo/redo, zoom and pan.
- Object selection with Shift-click for multiple objects, intersecting rectangles, and polygon-based lasso intersection including crossing edges and concave regions.
- Ordered context previews with separately identified nearby headings; unrelated board content is excluded. Empty selections are valid. Object and character limits are enforced on the server.
- Frozen, durable selection snapshots. Follow-ups use only completed turns for that selection. A new selection starts a separate conversation. Edits do not silently mutate prior context.
- Manual transcription for strokes and unlabeled shapes. AI requests are blocked until the object is transcribed and reselected. There is no OCR provider in this slice.
- Contextual explanations, summaries and examples, streamed through SSE with cancellation, timeout handling, explicit failures and persisted partial-response status.
- Server-side autosave, manual save, board switching, restoration, idempotent operation batches and optimistic version conflict detection. JSON export includes the board and interactions.

Selection and chat are available through the **Objects** list as well as through the canvas. Double-click objects to edit them. The shortcut dialog lists drawing keys; Ctrl+Z undoes, Ctrl+Shift+Z redoes and Ctrl+S saves.

## Check the implementation

```powershell
npm.cmd run check
```

This runs the Python regression suite, frontend stream-parser tests and the production frontend build (including TypeScript checking). The suite covers geometry, context exclusion, empty/invalid/oversized selections, object and board ownership, save atomicity, idempotent retries, stale versions, follow-up isolation, frozen snapshots, provider failures, timeouts, interrupted streams and cancellation. Parser tests cover split Unicode, SSE framing and stream cleanup. Provider adapters are exercised with test doubles; real-model quality and live credentials require separate evaluation.

After the build, run the isolated process-level check:

```powershell
python scripts/smoke.py
```

It starts a production Next.js server and Python API on temporary loopback ports, uses a temporary database, and checks the full HTTP path through the frontend proxy, progressive streaming, disconnect cancellation and API restart persistence. It then stops both services and removes its temporary data. It does not perform visual browser testing.

## Local data and configuration

The API stores data in `services/api/data/smartboard.db`, outside source control. Both board content and AI interaction history survive application restarts. `smartboard:lastBoard` in browser local storage remembers which server board to open. Clearing browser storage does not delete the saved boards. Unsaved changes trigger the browser's standard leave-page protection. Save failures offer a local draft download and an explicit action to discard that draft and reload the server version.

For PostgreSQL, provision a database and set:

```dotenv
DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/smartboard
```

The schema is created on startup for this development slice. Production migration management and PostgreSQL integration checks remain follow-up work. No PostgreSQL server is provisioned by this repository.

Default `AUTH_MODE=dev` supplies one fixed local learner and accepts requests only from loopback. User and tenant headers cannot select an identity. This is a development session, not a login feature. With `AUTH_MODE=oidc`, the API verifies JWT signature, expiry, issuer and audience using `OIDC_ISSUER`, `OIDC_AUDIENCE` and `OIDC_JWKS_URL`; claims must contain `sub` and `tenant_id`. The web proxy forwards bearer tokens, but a browser login/token acquisition flow is outside this slice. Every board, operation, selection and AI request checks tenant and owner access.

Run **one API worker**: active-request guards and request quotas are process-local, and startup marks unfinished requests as interrupted. Multi-worker deployment needs shared rate limits and request leases. For a personal hosted backend, use `AUTH_MODE=token` and a strong `APP_ACCESS_TOKEN` as described in the Android hosting guide. For independently authenticated users, configure OIDC and a browser/mobile sign-in flow.

See [the implementation notes](docs/vertical-slice.md) for the SRS mapping, API contract and remaining scope.
