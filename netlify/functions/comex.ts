// netlify/functions/comex.ts
// Proxy server-side para a API do ComexStat (evita bloqueio no browser)

import type { Handler } from "@netlify/functions";

const UPSTREAM_BASE = "https://api-comexstat.mdic.gov.br";

export const handler: Handler = async (event) => {
  try {
    // Ex.: event.path = "/.netlify/functions/comex/general"
    const prefix = "/.netlify/functions/comex";
    const splat = event.path.startsWith(prefix)
      ? event.path.slice(prefix.length)
      : event.path;

    // splat começa com "/general" etc.
    const upstreamUrl =
      UPSTREAM_BASE +
      splat +
      (event.rawQuery ? `?${event.rawQuery}` : "");

    const method = event.httpMethod || "GET";

    // Repasse mínimo de headers (evita mandar host/origin do Netlify pro upstream)
    const headers: Record<string, string> = {
      "accept": event.headers["accept"] || "application/json, text/plain, */*",
    };

    // Se vier POST/PUT com body, repassa content-type
    const contentType = event.headers["content-type"];
    if (contentType) headers["content-type"] = contentType;

    const res = await fetch(upstreamUrl, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : (event.body || undefined),
    });

    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json; charset=utf-8",
        // opcional: cache curto para não martelar upstream
        "cache-control": "no-store",
      },
      body: text,
    };
  } catch (err: any) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        message: "Proxy ComexStat falhou",
        error: String(err?.message || err),
      }),
    };
  }
};