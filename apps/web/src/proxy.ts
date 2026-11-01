import { NextResponse, type NextRequest } from "next/server";
import { matchesBasicCredentials } from "./lib/web-auth.ts";

export function proxy(request: NextRequest) {
  const username = process.env.WEB_AUTH_USERNAME;
  const password = process.env.WEB_AUTH_PASSWORD;

  if (!username && !password) return NextResponse.next();
  if (!username || !password)
    return new Response("Web authentication is not configured.", {
      status: 503,
    });

  if (
    matchesBasicCredentials(
      request.headers.get("authorization") || "",
      username,
      password,
    )
  )
    return NextResponse.next();

  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Smartboard", charset="UTF-8"' },
  });
}
