import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesBasicCredentials } from "../src/lib/web-auth.ts";

const username = "smartboard";
const password = "correct horse battery staple";
const validAuthorization = `Basic ${Buffer.from(
  `${username}:${password}`,
).toString("base64")}`;

test("accepts matching Basic Auth credentials", () => {
  assert.equal(
    matchesBasicCredentials(validAuthorization, username, password),
    true,
  );
});

test("rejects a different username or password", () => {
  assert.equal(
    matchesBasicCredentials(validAuthorization, "another-user", password),
    false,
  );
  assert.equal(
    matchesBasicCredentials(validAuthorization, username, "incorrect"),
    false,
  );
});

test("rejects missing, non-Basic, and malformed credentials", () => {
  assert.equal(matchesBasicCredentials("", username, password), false);
  assert.equal(
    matchesBasicCredentials("Bearer token", username, password),
    false,
  );
  assert.equal(
    matchesBasicCredentials("Basic invalid", username, password),
    false,
  );
});

test("supports colons in the password", () => {
  const colonPassword = "part-one:part-two";
  const authorization = `Basic ${Buffer.from(
    `${username}:${colonPassword}`,
  ).toString("base64")}`;

  assert.equal(
    matchesBasicCredentials(authorization, username, colonPassword),
    true,
  );
});
