# Android APK and free backend hosting

The APK bundles the Smartboard interface and uses your hosted Python backend for board storage, selection and AI. A running backend and internet connection are required. This build does not embed Python or an offline AI model.

## Install the APK

Copy `artifacts/android/Smartboard-0.1.0.apk` to your phone and open it. Android will ask you to permit installation from the app opening the file. This is a debug-signed personal testing build, not a Play Store release. It supports Android 9 or later with an up-to-date Android System WebView.

Open **Smartboard → Connect backend**. Enter your backend's HTTPS base URL, such as `https://smartboard-api.onrender.com`, and its `APP_ACCESS_TOKEN`. The app checks the connection before saving it. Use **Server** in the native toolbar to change the connection later. The token is encrypted using Android Keystore and is never embedded in the APK or passed to page JavaScript. The OpenAI key stays on your backend.

The board UI and assets are bundled locally. API requests use a native HTTPS bridge that delivers stream chunks to the shared SSE parser. Android's document picker handles JSON exports without requesting storage permissions. Remote pages cannot navigate inside the WebView containing the native bridge.

## Free hosted setup

Use [Render Free](https://render.com/docs/free) for FastAPI and [Neon Free](https://neon.com/pricing) for PostgreSQL. Both have usage limits. Render's free web service sleeps after 15 idle minutes, takes roughly a minute to wake, and loses local files on restarts/spin-down. Its free PostgreSQL service expires after 30 days, so use Neon for longer-lived board data. Do not use the local SQLite default on an ephemeral host.

1. Push this project to a GitHub, GitLab or Bitbucket repository. Do not commit `.env`, database files or access tokens.
2. Create a Neon Free project in a region near your Render service. In Neon's connection panel, copy the PostgreSQL connection string with TLS enabled. The API accepts `postgresql://`, `postgres://` and `postgresql+psycopg://` URLs and chooses the psycopg 3 driver.
3. In Render, create a Blueprint from the repository. The included root `render.yaml` specifies a **Free** service, Python 3.12, one API worker, the build/start commands, token authentication and a generated app access token. Supply the Neon connection string when prompted for `DATABASE_URL`.
4. Deploy and wait for `/api/v1/health` to return a JSON response with `data.status` equal to `ok`.
5. In Render's environment settings, copy the generated `APP_ACCESS_TOKEN` into the APK's connection screen. Do not paste it into chat, source files, public logs or a URL. Enter the service's base HTTPS URL, without `/docs` or `/api`.
6. The service starts with `LLM_PROVIDER=demo`. Select the example equation and ask for an explanation to verify the full path. Demo replies are scripted and labeled.

For manual Render service creation, use:

| Setting | Value |
| --- | --- |
| Service type | Web Service |
| Runtime | Python 3 |
| Instance type | Free |
| Root directory | `services/api` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn smartboard.main:app --host 0.0.0.0 --port $PORT --workers 1` |
| Health check | `/api/v1/health` |
| `PYTHON_VERSION` | `3.12.12` |
| `DATABASE_URL` | Neon connection string with TLS enabled |
| `AUTH_MODE` | `token` |
| `APP_ACCESS_TOKEN` | A random secret containing at least 32 characters |
| `LLM_PROVIDER` | `demo` |

Generate a personal access token locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Anyone holding this token can access this one personal workspace. For independently authenticated users, use the existing OIDC mode and implement account sign-in; do not distribute one shared personal token to a class.

To enable live OpenAI responses, set `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL` in Render's environment, then restart the service. Hosting on a free tier does not make external LLM usage free. Leave demo mode enabled if you want to avoid live model requests.

This repository is deployment-ready but has not been deployed into a hosting account. You must create/connect your Render and Neon accounts and provide their configuration. No hosting URL, database credential or LLM key is baked into the APK.

## Rebuild

Install the frontend dependencies, JDK 17, Android SDK platform 36 and build tools 36.0.0. Set `ANDROID_HOME` to your SDK path, then run from the root:

```powershell
npm.cmd run android:build
```

The build script exports a generated copy of the Next.js app without server routes, copies the generated web files into Android assets and runs Gradle 8.13 / Android Gradle Plugin 8.13.0. It leaves the web app's normal server build intact and writes the signed APK to `artifacts/android/`.

Run `npm.cmd run check` for the backend, frontend data/transport tests and web production build. The Android native project can additionally be checked with `apps/android/gradlew.bat -p apps/android lintDebug`.

The delivered build passed 36 Python tests, 7 frontend data/stream/native-transport tests, the web production build, the Android static export and Gradle APK assembly. Android lint completes with no errors (advisory warnings remain). APK signature verification passes, and the package check confirms all 13 exported web assets and the native transport are present. A SHA-256 checksum is included beside the APK. Installation and interaction on a physical phone, live OpenAI responses and a deployed Render/Neon environment have not been verified in this session.
