/**
 * curl-backed drop-in replacement for global fetch(), scoped to Figma REST calls.
 *
 * WHY THIS EXISTS
 * Node's built-in fetch (undici) ignores HTTP_PROXY / HTTPS_PROXY. Claude Code's
 * Bash sandbox routes all egress through a localhost proxy, so node fetch dies with
 * `getaddrinfo ENOTFOUND api.figma.com` while curl -- which does honour those
 * variables -- succeeds. NODE_USE_ENV_PROXY=1 would fix it without this file, but
 * that landed in Node 24 and this repo runs v22.
 *
 * curl behaves identically inside the sandbox (via the proxy) and outside it
 * (direct), so there is a single code path rather than an environment branch --
 * the same command works from a normal terminal and from an agent session.
 *
 * Deliberately dependency-free. `tokens/scripts/` does not exist upstream, so
 * changes here cost nothing on an upstream sync, whereas adding `undici` to
 * devDependencies would conflict on every one. If this tooling is ever merged
 * upstream or distributed, swap this for undici's ProxyAgent -- see
 * `decision-curl-over-undici` in project memory.
 *
 * The returned object mimics just enough of Response -- { ok, status, statusText,
 * text(), json() } -- that switching a call site is `fetch(` -> `figmaFetch(`
 * with no other edit, preserving each script's own error messages.
 */

import { execFile } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// /v1/files/{traton}/variables/local is ~1.1 MB today; leave generous headroom.
const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 120;

/** Escape a value for use inside a double-quoted curl config parameter. */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Perform a Figma REST request via curl.
 *
 * Secrets never reach argv: the URL and every header are written to a curl
 * config file streamed on stdin, so the token does not appear in `ps` output.
 * A request body, when present, goes to a short-lived temp file instead --
 * stdin is already taken by the config, and the body is spec data, not a secret.
 *
 * @param {string} url Absolute URL.
 * @param {{ method?: string, headers?: Record<string,string>, body?: string,
 *           timeoutSeconds?: number }} [options]
 * @returns {Promise<{ ok: boolean, status: number, statusText: string,
 *                     text: () => Promise<string>, json: () => Promise<any> }>}
 */
export async function figmaFetch(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  } = options;

  const config = [
    `url = ${quote(url)}`,
    'silent',
    'show-error',
    // Report the final status on its own trailing line so it can be split off
    // the body without parsing headers.
    `write-out = ${quote('\\n%{http_code}')}`,
    `max-time = ${timeoutSeconds}`,
    `request = ${quote(method)}`,
  ];

  for (const [name, value] of Object.entries(headers)) {
    config.push(`header = ${quote(`${name}: ${value}`)}`);
  }

  let bodyPath;
  if (body !== undefined && body !== null) {
    bodyPath = join(tmpdir(), `figma-rest-${randomUUID()}.json`);
    writeFileSync(bodyPath, body);
    config.push(`data-binary = ${quote(`@${bodyPath}`)}`);
  }

  try {
    const raw = await new Promise((resolve, reject) => {
      const child = execFile(
        'curl',
        ['--config', '-'],
        { maxBuffer: MAX_BUFFER, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            const detail = (stderr || '').trim() || error.message;
            if (error.code === 'ENOENT') {
              reject(
                new Error(
                  'curl not found on PATH. tokens/scripts/lib/figma-rest.js ' +
                    'requires curl; see the note at the top of that file.'
                )
              );
              return;
            }
            reject(new Error(`curl failed for ${method} ${url}: ${detail}`));
            return;
          }
          resolve(stdout);
        }
      );
      child.stdin.end(config.join('\n') + '\n');
    });

    // write-out appended "\n<status>"; everything before that newline is the body.
    const split = raw.lastIndexOf('\n');
    const payload = split === -1 ? '' : raw.slice(0, split);
    const status = Number.parseInt(raw.slice(split + 1).trim(), 10);

    if (!Number.isFinite(status) || status === 0) {
      throw new Error(
        `curl produced no HTTP status for ${method} ${url} ` +
          `(body was ${payload.length} bytes)`
      );
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: async () => payload,
      json: async () => JSON.parse(payload),
    };
  } finally {
    if (bodyPath) {
      try {
        unlinkSync(bodyPath);
      } catch {
        // Temp file cleanup is best-effort; never mask the real result.
      }
    }
  }
}

export default figmaFetch;
