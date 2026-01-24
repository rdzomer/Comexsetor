// netlify/functions/comex.ts
// Proxy server-side para a API do ComexStat (evita bloqueio no browser)
//
// Objetivo: ser o ÚNICO caminho em produção (Netlify) para chamadas ao ComexStat,
// evitando 451/CORS/Mixed Content no navegador.

import type { Handler } from "@netlify/functions";
import { Buffer } from "buffer";

const UPSTREAM_BASE = "https://api-comexstat.mdic.gov.br";

// Timeout defensivo para não deixar fetch pendurado e provocar 502 em cascata
const FETCH_TIMEOUT_MS = 25_000;

export const handler: Handler = async (event) => {
  try {
    // Ex.: event.path = "/.netlify/functions/comex/general"
    const prefix = "/.netlify/functions/comex";
    const splat = event.path.startsWith(prefix)
      ? event.path.slice(prefix.length)
      : event.path;

    // splat começa com "/general" etc.
    const upstreamUrl =
      UPSTREAM_BASE + splat + (event.rawQuery ? `?${event.rawQuery}` : "");

    const method = (event.httpMethod || "GET").toUpperCase();

    // Repasse mínimo de headers (evita mandar host/origin do Netlify pro upstream),
    // mas adiciona assinatura estável para reduzir chance de bloqueio/reset no upstream.
    const headers: Record<string, string> = {
      accept: event.headers["accept"] || "application/json, text/plain, */*",
      "accept-language":
        event.headers["accept-language"] ||
        "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      // User-Agent explícito ajuda alguns WAFs/CDNs a não tratar como tráfego "anômalo"
      "user-agent": "comexsetor-netlify-proxy/1.0",
    };

    // Se vier body, repassa content-type
    const contentType = event.headers["content-type"];
    if (contentType) headers["content-type"] = contentType;

    // Trata body base64 quando necessário
    let body: string | undefined = undefined;
    if (!["GET", "HEAD"].includes(method)) {
      if (event.body) {
        body = event.isBase64Encoded
          ? Buffer.from(event.body, "base64").toString("utf-8")
          : event.body;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(upstreamUrl, {
        method,
        headers,
        body: ["GET", "HEAD"].includes(method) ? undefined : body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        "content-type":
          res.headers.get("content-type") || "application/json; charset=utf-8",
        // Cache curto/zero para não servir dados velhos e evitar martelar upstream em reloads rápidos
        "cache-control": "no-store",
      },
      body: text,
    };
  } catch (err: any) {
    // Tenta expor causa real quando o runtime fornece (Node fetch costuma trazer err.cause)
    const cause = err?.cause ? ` | cause: ${String(err.cause)}` : "";
    const name = err?.name ? `${String(err.name)}: ` : "";
    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        message: "Proxy ComexStat falhou",
        error: `${name}${String(err?.message || err)}${cause}`,
      }),
    };
  }
};