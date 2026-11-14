/**
 * Same-origin screenshot proxy for saved heatmaps (D-026). Pure: the route
 * handler injects authorization and the server-only loaders.
 *
 * Order matters: authorize (requireAnalyticsAdmin) → validate input → resolve the
 * heatmap through the same origin/route filter as the gallery → fetch bytes.
 * Responses carry only our own headers; the PostHog bearer key, upstream
 * headers and provider error bodies never reach the browser.
 */
import {
  chooseWidth,
  isShortId,
  parseWidth,
  proxyError,
  proxyHeaders,
  type HeatmapDetail,
  type ScreenshotResult,
} from "./heatmaps.ts";

export interface ProxyDeps {
  /** Must throw/redirect for anyone but the analytics admin (requireAnalyticsAdmin). */
  authorize: () => Promise<unknown>;
  getHeatmap: (shortId: string) => Promise<HeatmapDetail>;
  getScreenshot: (id: string, width: number) => Promise<ScreenshotResult>;
}

function json(kind: Parameters<typeof proxyError>[0]): Response {
  const { status, body } = proxyError(kind);
  return new Response(JSON.stringify(body), {
    status,
    headers: proxyHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" }),
  });
}

export async function screenshotProxy(
  input: { shortId: string | undefined; width: string | null },
  deps: ProxyDeps,
): Promise<Response> {
  // Not wrapped in try: a redirect/denial from authorization must propagate.
  await deps.authorize();

  if (!isShortId(input.shortId)) return json("bad-request");
  const asked = input.width === null ? null : parseWidth(input.width);
  if (input.width !== null && asked === null) return json("bad-request");

  const detail = await deps.getHeatmap(input.shortId);
  if (detail.state === "not-found") return json("not-found");
  if (detail.state === "not-configured") return json("not-configured");
  if (detail.state !== "ok") return json(detail.state);

  const width = chooseWidth(detail.heatmap, asked);
  if (width === null) return json(detail.heatmap.status === "processing" ? "processing" : "failed");

  const shot = await deps.getScreenshot(detail.heatmap.id, width);
  if (shot.kind !== "image") return json(shot.kind);
  const headers = proxyHeaders({
    "Content-Type": shot.contentType,
    "Content-Disposition": "inline",
    ...(shot.length !== null ? { "Content-Length": String(shot.length) } : {}),
  });
  return new Response(shot.body, { status: 200, headers });
}
