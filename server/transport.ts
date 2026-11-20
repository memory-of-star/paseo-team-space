import { z } from "zod";

export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function serviceUrl(raw: string): string {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Enter the service origin without credentials, a path, or query parameters",
    );
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const teamHttpOrigin = "http://47.94.77.187:18787";
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && (loopback || url.origin === teamHttpOrigin))
  )
    throw new Error(
      `Use HTTPS, localhost, or the configured HTTP team service at ${teamHttpOrigin}`,
    );
  return url.origin;
}
export async function request<T>(
  url: string,
  path: string,
  schema: z.ZodType<T>,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
    bootstrapToken?: string;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${serviceUrl(url)}${path}`, {
      method: options.method ?? "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.bootstrapToken
          ? { "X-Bootstrap-Token": options.bootstrapToken }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (Number(response.headers.get("content-length") ?? 0) > 4_000_000)
      throw new Error("Team service response exceeds size limit");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty team service response");
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 4_000_000)
          throw new Error("Team service response exceeds size limit");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(data);
      throw new ServiceError(
        response.status,
        parsed.success
          ? parsed.data.error
          : `Team service returned ${response.status}`,
      );
    }
    return schema.parse(data);
  } finally {
    clearTimeout(timer);
  }
}
