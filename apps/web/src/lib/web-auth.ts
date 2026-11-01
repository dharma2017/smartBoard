export function matchesBasicCredentials(
  authorization: string,
  username: string,
  password: string,
): boolean {
  const [scheme, encoded = ""] = authorization.split(" ", 2);
  if (scheme !== "Basic") return false;

  const credentials = Buffer.from(encoded, "base64").toString("utf8");
  const separator = credentials.indexOf(":");
  return (
    separator >= 0 &&
    credentials.slice(0, separator) === username &&
    credentials.slice(separator + 1) === password
  );
}
