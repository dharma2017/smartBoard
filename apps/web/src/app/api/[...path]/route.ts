import { NextRequest } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The browser never receives service credentials or an OpenAI key.
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (path.some((p) => p === ".." || !/^[a-zA-Z0-9_-]+$/.test(p)))
    return Response.json(
      { error: { message: "Invalid API path" } },
      { status: 400 },
    );
  const webAuthEnabled =
    Boolean(process.env.WEB_AUTH_USERNAME) ||
    Boolean(process.env.WEB_AUTH_PASSWORD);
  if (webAuthEnabled && !process.env.APP_ACCESS_TOKEN)
    return Response.json(
      { error: { message: "The web service API token is not configured." } },
      { status: 503 },
    );
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["idempotency-key", "x-request-id"])
    if (request.headers.has(name))
      headers.set(name, request.headers.get(name)!);
  const apiToken = process.env.APP_ACCESS_TOKEN;
  if (apiToken) headers.set("Authorization", `Bearer ${apiToken}`);
  else if (!webAuthEnabled && request.headers.has("authorization"))
    headers.set("Authorization", request.headers.get("authorization")!);
  try {
    const upstream = await fetch(
      `${process.env.BOARD_SERVICE_URL || "http://127.0.0.1:8000"}/api/${path.join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.text(),
        cache: "no-store",
        signal: request.signal,
      },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message:
            "The board service is unavailable. Start the services and try again.",
        },
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST };
