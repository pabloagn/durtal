import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, lstat, realpath, unlink } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { z } from "zod/v4";
import { boundedJsonBytes } from "./bounded-json";
import { requirePrivateAbsolutePath, requireSha256 } from "./runtime-contract";
import { UPLOAD_LIMITS } from "./limits";
import { UploadError, uploadBatchViewSchema, uploadItemViewSchema, uploadOutcomeSchema } from "./protocol";
import { admissionRefusalSchema, UploadAdmissionRefusal } from "./admission-refusal";
import type { SupervisorHostLock } from "./host-lock";
import type { UploadCoreContext } from "./core-contract";
import type { UploadGateway } from "./broker";

const JSON_BYTES = 64 * 1024;
const REPLY_BYTES = 256 * 1024;
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export interface UploadBridgeConfig {
  socketPath: string;
  /** Explicit shared 32-byte secret, never generated/logged/inherited by the inspector. */
  secret: string;
  targetFingerprint: string;
  bindingSha256: string;
}
function validateConfig(config: UploadBridgeConfig): void {
  requirePrivateAbsolutePath(config.socketPath);
  if (Buffer.byteLength(config.socketPath) > 100) throw new Error("Upload bridge socket path exceeds the platform bound");
  requireSha256(config.secret); requireSha256(config.targetFingerprint); requireSha256(config.bindingSha256);
}
async function privateParent(at: string): Promise<void> {
  const parent = path.dirname(at); const info = await lstat(parent);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid?.() || info.gid !== process.getgid?.()
    || await realpath(parent) !== parent) throw new Error("Upload bridge requires an existing owned private real directory");
}
async function privateSocket(at: string): Promise<{ ino: number; dev: number }> {
  await privateParent(at); const info = await lstat(at);
  if (!info.isSocket() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.() || info.gid !== process.getgid?.())
    throw new Error("Upload bridge socket ownership differs");
  return { ino: info.ino, dev: info.dev };
}
const digest = (value: string) => createHash("sha256").update(value).digest();
function header(req: IncomingMessage, name: string): string | null {
  const raw = req.headers[name]; return typeof raw === "string" ? raw : null;
}
async function readJson(stream: AsyncIterable<Uint8Array>, maximum: number): Promise<unknown> {
  const chunks: Uint8Array[] = []; let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > maximum) throw new UploadError(413, "request_too_large", "Upload bridge metadata exceeds its bound.");
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
  catch { throw new UploadError(400, "invalid_input", "Upload bridge metadata is invalid."); }
}
/** Canceling an already acknowledged part drains at most one bounded part,
 * preserving the socket long enough to return its original acknowledgement.
 */
function partStream(req: IncomingMessage): ReadableStream<Uint8Array> {
  const iterator = req.iterator({ destroyOnReturn: false }); let bytes = 0;
  const next = async () => {
    const item = await iterator.next();
    if (!item.done) {
      bytes += (item.value as Buffer).byteLength;
      if (bytes > UPLOAD_LIMITS.partBytes) { req.destroy(); throw new UploadError(413, "part_too_large", "Upload part exceeds 8 MiB."); }
    }
    return item;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) { try { const item = await next(); if (item.done) controller.close(); else controller.enqueue(item.value as Buffer); }
      catch (error) { controller.error(error); } },
    async cancel() { while (!(await next()).done) {} await iterator.return?.(undefined); },
  }, { highWaterMark: 0 });
}
function reply(res: ServerResponse, status: number, value: unknown): void {
  boundedJsonBytes(value, REPLY_BYTES); const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": body.length, "Cache-Control": "no-store" }); res.end(body);
}

/** Explicit authenticated Unix listener, separate from the physical host mutex.
 * The app gets no Docker socket/CLI or spool file API. No startup on import.
 */
export class UploadHostBridge {
  private server: Server | null = null;
  private socket: { ino: number; dev: number } | null = null;
  private closing: Promise<void> | null = null;
  private accepting = false;
  private active = 0;
  private readonly handlers = new Set<Promise<void>>();
  constructor(private readonly config: UploadBridgeConfig, private readonly gateway: UploadGateway, private readonly hostLock: SupervisorHostLock) {
    validateConfig(config);
  }
  async start(): Promise<void> {
    if (this.server) throw new Error("Upload bridge already started");
    this.hostLock.assertHeld(); await privateParent(this.config.socketPath);
    // A crash leaves a socket name. Only the physically exclusive owner may
    // remove a verified old owned socket, never an arbitrary file/symlink.
    const old = await lstat(this.config.socketPath).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (old) { await privateSocket(this.config.socketPath); this.hostLock.assertHeld(); await unlink(this.config.socketPath); }
    const server = createServer((req, res) => {
      const handler = this.handle(req, res); this.handlers.add(handler);
      void handler.finally(() => this.handlers.delete(handler)).catch(() => { req.destroy(); res.destroy(); });
    });
    this.server = server; server.maxConnections = 16; server.maxHeadersCount = 32;
    server.on('error', () => { this.accepting = false; });
    server.headersTimeout = 10_000; server.requestTimeout = UPLOAD_LIMITS.inspectionMs; server.keepAliveTimeout = 1000;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(this.config.socketPath, () => { server.removeListener("error", reject); resolve(); }); });
    await chmod(this.config.socketPath, 0o600); this.socket = await privateSocket(this.config.socketPath);
    this.hostLock.assertHeld(); this.accepting = true;
  }
  closeAdmissions(): void {
    this.accepting = false;
    if (this.server && !this.closing) {
      this.closing = new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()));
      void this.closing.catch(() => {}); // retain the rejection for stop(), observe it immediately
      this.server.closeIdleConnections();
    }
  }
  async stop(): Promise<void> {
    this.closeAdmissions();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all([this.closing, ...this.handlers]), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Upload bridge requests remain unsettled; ownership stays held")), UPLOAD_LIMITS.cleanupMs);
      })]);
      if (this.socket) {
        this.hostLock.assertHeld(); const actual = await lstat(this.config.socketPath).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
        // Node may already unlink a listening Unix socket on close.
        if (actual) { const verified = await privateSocket(this.config.socketPath);
          if (verified.ino !== this.socket.ino || verified.dev !== this.socket.dev) throw new Error("Upload bridge socket changed during shutdown");
          await unlink(this.config.socketPath);
        }
      }
      this.server = null; this.socket = null;
    } finally { clearTimeout(timer); }
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let admitted = false;
    try {
      if (!this.accepting) throw new UploadError(503, "upload_unavailable", "The upload service is stopping.");
      this.hostLock.assertHeld();
      const authorization = header(req, 'authorization') ?? '';
      if (authorization.length > 128 || !timingSafeEqual(digest(authorization), digest(`Bearer ${this.config.secret}`))
        || header(req, 'x-upload-binding') !== this.config.bindingSha256 || header(req, 'x-upload-target') !== this.config.targetFingerprint)
        throw new UploadError(403, "access_refused", "Upload bridge access refused.");
      if (this.active >= 8) throw new UploadError(503, "upload_busy", "Upload bridge concurrency limit reached.");
      this.active++; admitted = true;
      const channel = header(req, 'x-upload-channel');
      if (channel !== 'ui' && channel !== 'api') throw new UploadError(400, "invalid_input", "Upload channel is missing.");
      if (req.method === 'GET' && req.url === '/v1/ready') { reply(res, 200, { ready: await this.gateway.ready() }); return; }
      const batch = req.url?.match(new RegExp(`^/v1/batches/(${uuid})$`));
      const item = req.url?.match(new RegExp(`^/v1/items/(${uuid})$`));
      const part = req.url?.match(new RegExp(`^/v1/items/(${uuid})/parts/([1-9][0-9]{0,2})$`));
      if (req.method === 'GET' && batch) { reply(res, 200, await this.gateway.batch(batch[1], channel)); return; }
      if (req.method === 'GET' && item) { reply(res, 200, await this.gateway.item(item[1], channel)); return; }
      if (req.method === 'PUT' && part) {
        const generation = header(req, 'x-upload-generation') ?? ''; const sha256 = header(req, 'x-upload-sha256') ?? '';
        const length = header(req, 'content-length');
        if (!/^(0|[1-9][0-9]*)$/.test(generation) || !Number.isSafeInteger(Number(generation)) || Number(part[2]) > 512
          || (length !== null && (!/^[1-9][0-9]*$/.test(length) || Number(length) > UPLOAD_LIMITS.partBytes))
          || header(req, 'content-type') !== 'application/octet-stream' || req.headers['content-encoding'])
          throw new UploadError(400, "invalid_part", "Upload part framing differs.");
        requireSha256(sha256);
        reply(res, 200, await this.gateway.part({ id: part[1], number: Number(part[2]), generation: Number(generation), sha256, body: partStream(req) })); return;
      }
      if (req.method !== 'POST' || !(req.url === '/v1/batches' || item)) throw new UploadError(404, "upload_not_found", "Upload bridge route not found.");
      const length = header(req, 'content-length');
      if (header(req, 'content-type') !== 'application/json' || req.headers['content-encoding']
        || (length !== null && (!/^[1-9][0-9]*$/.test(length) || Number(length) > JSON_BYTES)))
        throw new UploadError(400, "invalid_input", "Upload bridge metadata framing differs.");
      const body = await readJson(req, JSON_BYTES);
      if (item) { const outcome = await this.gateway.command(item[1], body, channel); reply(res, outcome.status, outcome); }
      else reply(res, 201, await this.gateway.create(body, channel));
    } catch (error) {
      res.shouldKeepAlive = false;
      if (!res.headersSent && !res.destroyed) {
        const status = error instanceof UploadError ? error.status : error instanceof z.ZodError ? 400 : 503;
        reply(res, status, { code: error instanceof UploadError ? error.code : status === 400 ? 'invalid_input' : 'outcome_unknown_retry_original',
          error: error instanceof UploadError ? error.message : "The upload response is uncertain. Retry the same request.",
          ...(error instanceof UploadAdmissionRefusal ? { refusal: error.refusal } : {}) });
      }
      // A refused/invalid body is never read into memory. Close the connection
      // after the small response instead of admitting another request on it.
    } finally { if (admitted) this.active--; }
  }
}

/** Install explicitly in the app process using installUploadBroker(client).
 * This client opens no listener and has no inspector/spool/core write access.
 */
export class UploadHostClient implements UploadGateway {
  constructor(private readonly config: UploadBridgeConfig) { validateConfig(config); }
  private async call(method: string, url: string, channel: UploadCoreContext['channel'], body?: unknown | ReadableStream<Uint8Array>, extra: Record<string, string> = {}, allowReceipt = false): Promise<unknown> {
    await privateSocket(this.config.socketPath);
    const stream = body instanceof ReadableStream ? Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]) : null;
    let bytes: Buffer | undefined;
    if (body !== undefined && !stream) { boundedJsonBytes(body, JSON_BYTES); bytes = Buffer.from(JSON.stringify(body)); }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: unknown) => {
        if (settled) return; settled = true; clearTimeout(deadline);
        if (error) reject(error); else resolve(value);
      };
      const req = request({ socketPath: this.config.socketPath, path: url, method,
        headers: { authorization: `Bearer ${this.config.secret}`, 'x-upload-binding': this.config.bindingSha256,
          'x-upload-target': this.config.targetFingerprint, 'x-upload-channel': channel,
          ...(bytes ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}), ...extra } }, (res) => {
        void readJson(res, REPLY_BYTES).then((value) => {
          if (!res.statusCode || res.statusCode >= 400) {
            const receipt = allowReceipt ? uploadOutcomeSchema.safeParse(value) : null;
            if (receipt?.success && receipt.data.status === res.statusCode) { finish(null, receipt.data); return; }
            const raw = value as { code?: unknown; error?: unknown };
            if (res.statusCode === 409 && raw?.code === 'generation_changed') {
              const refusal = admissionRefusalSchema.safeParse((value as { refusal?: unknown }).refusal);
              if (refusal.success) throw new UploadAdmissionRefusal(refusal.data);
            }
            const status = res.statusCode === 400 || res.statusCode === 403 || res.statusCode === 404 || res.statusCode === 409 || res.statusCode === 413 ? res.statusCode : 503;
            throw new UploadError(status, typeof raw?.code === 'string' ? raw.code : 'outcome_unknown_retry_original',
              typeof raw?.error === 'string' ? raw.error.slice(0, 900) : 'Upload service response is uncertain. Retry the same request.');
          }
          finish(null, value);
        }).catch((error) => finish(error));
      });
      const deadline = setTimeout(() => req.destroy(new Error('Upload bridge wall deadline expired')), UPLOAD_LIMITS.inspectionMs);
      req.setTimeout(UPLOAD_LIMITS.inspectionMs, () => req.destroy(new Error('Upload bridge response deadline expired')));
      req.once('error', (error) => { stream?.destroy(); finish(error); });
      req.once('close', () => stream?.destroy());
      if (stream) { stream.once('error', (error) => req.destroy(error)); stream.pipe(req); }
      else req.end(bytes);
    });
  }
  async ready(): Promise<boolean> { const reply = z.object({ ready: z.boolean() }).strict().parse(await this.call('GET', '/v1/ready', 'ui')); return reply.ready; }
  async create(input: unknown, channel: UploadCoreContext['channel']) { return uploadBatchViewSchema.parse(await this.call('POST', '/v1/batches', channel, input)); }
  async batch(id: string, channel: UploadCoreContext['channel']) { z.uuid().parse(id); return uploadBatchViewSchema.parse(await this.call('GET', `/v1/batches/${id}`, channel)); }
  async item(id: string, channel: UploadCoreContext['channel']) { z.uuid().parse(id); return uploadItemViewSchema.parse(await this.call('GET', `/v1/items/${id}`, channel)); }
  async command(id: string, input: unknown, channel: UploadCoreContext['channel']) { z.uuid().parse(id); return uploadOutcomeSchema.parse(await this.call('POST', `/v1/items/${id}`, channel, input, {}, true)); }
  async part(input: Parameters<UploadGateway['part']>[0]) {
    z.uuid().parse(input.id); requireSha256(input.sha256);
    z.number().int().min(1).max(512).parse(input.number); z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(input.generation);
    return z.object({ number: z.number().int().min(1).max(512), bytes: z.number().int().positive().max(UPLOAD_LIMITS.partBytes),
      sha256: z.string().regex(/^[a-f0-9]{64}$/), generation: z.number().int().nonnegative() }).strict().parse(
      await this.call('PUT', `/v1/items/${input.id}/parts/${input.number}`, 'ui', input.body,
        { 'content-type': 'application/octet-stream', 'x-upload-generation': String(input.generation), 'x-upload-sha256': input.sha256 }));
  }
}
