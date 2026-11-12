// Native-owned candidate. Only Node builtins; never load the child Effect graph here.
import * as CP from 'node:child_process';
import * as FS from 'node:fs/promises';
import { constants as FSC } from 'node:fs';
import * as Crypto from 'node:crypto';
import * as Path from 'node:path';
import type { OwnedServiceBinding } from './cloud/serviceProtocol.ts';
const LIMIT = 64 * 1024;
export class OwnedBootstrapError extends Error {
    constructor() { super('Owned service bootstrap is unavailable.'); }
}
const fail = () => new OwnedBootstrapError();
const keys = (x: Record<string, unknown>, expected: string[]) => Object.keys(x).sort().join(',') === [...expected].sort().join(',');
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const safe = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0;
const hex = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
interface NativeBinding {
    schema: 1;
    selfSha256: string;
    manifestSha256: string;
    generation: number;
    environmentId: string;
    version: string;
}
interface Prepared {
    binding: OwnedServiceBinding;
}
async function readBounded(file: Awaited<ReturnType<typeof FS.open>>, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
        const buffer = Buffer.alloc(Math.min(65536, limit + 1 - total));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0)
            break;
        total += bytesRead;
        if (total > limit)
            throw fail();
        chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
}
async function privateFile(path: string, limit: number): Promise<Buffer> {
    const file = await FS.open(path, FSC.O_RDONLY | FSC.O_NOFOLLOW);
    try {
        const meta = await file.stat();
        if (!meta.isFile() || meta.nlink !== 1 || meta.uid !== process.getuid?.() || (meta.mode & 0o777) !== 0o600 || meta.size > limit)
            throw fail();
        const bytes = await readBounded(file, limit);
        return bytes;
    }
    finally {
        await file.close();
    }
}
export class OwnedLauncherBootstrap {
    readonly #child: CP.ChildProcessWithoutNullStreams;
    readonly #binding: NativeBinding;
    readonly #baseDir: string;
    readonly #onFailure: (error: Error) => void;
    #epoch: number;
    #session: string | undefined;
    #envelope: Buffer | undefined;
    #phase: 'idle' | 'prepared' | 'issued' = 'idle';
    #closed = false;
    #armed = false;
    #buffer = Buffer.alloc(0);
    #total = 0;
    #pending: {
        resolve: (x: Record<string, unknown>) => void;
        reject: (e: Error) => void;
        timer: NodeJS.Timeout;
    } | undefined;
    private constructor(child: CP.ChildProcessWithoutNullStreams, binding: NativeBinding, baseDir: string, epoch: number, onFailure: (e: Error) => void) {
        this.#child = child;
        this.#binding = binding;
        this.#baseDir = baseDir;
        this.#epoch = epoch;
        this.#onFailure = onFailure;
        child.stdout.on('data', (raw: Buffer) => this.#receive(raw));
        child.stdout.on('error', () => this.#fatal());
        child.stdin.on('error', () => this.#fatal());
        child.on('error', () => this.#fatal());
        child.once('exit', () => this.#fatal());
        // Drain bounded diagnostics without exposing secret frames or inheriting caller logs.
        let diagnostics = 0;
        child.stderr.on('data', (raw: Buffer) => {
            diagnostics += raw.length;
            if (diagnostics > LIMIT)
                this.#fatal();
        });
    }
    static async open(baseDir: string, onFailure: (e: Error) => void): Promise<OwnedLauncherBootstrap> {
        if (!Path.isAbsolute(baseDir) || /[\x00-\x1f\x7f]/.test(baseDir) || Path.basename(baseDir) !== 'host' || await FS.realpath(baseDir) !== baseDir)
            throw fail();
        const owner = Path.dirname(baseDir);
        for (const path of [owner, baseDir]) {
            const m = await FS.lstat(path);
            if (!m.isDirectory() || m.isSymbolicLink() || m.uid !== process.getuid?.() || (m.mode & 0o077) !== 0)
                throw fail();
        }
        if ((await privateFile(Path.join(owner, '.blackcrab-managed-host'), 64)).toString() !== 'blackcrab-managed-host-v1\n')
            throw fail();
        const binding: unknown = JSON.parse((await privateFile(Path.join(owner, 'native-issuer-binding.json'), LIMIT)).toString());
        if (!record(binding) || !keys(binding, ['schema', 'selfSha256', 'manifestSha256', 'generation', 'environmentId', 'version']) || binding.schema !== 1 || !hex(binding.selfSha256) || !hex(binding.manifestSha256) || !safe(binding.generation) || typeof binding.environmentId !== 'string' || !binding.environmentId || binding.environmentId.length > 128 || binding.environmentId.trim() !== binding.environmentId || /[\x00-\x1f\x7f]/.test(binding.environmentId) || binding.version !== '0.1.7')
            throw fail();
        const executable = Path.join(owner, 'issuer', binding.selfSha256, 'blackcrab-issuer');
        for (const path of [Path.join(owner, 'issuer'), Path.dirname(executable)]) {
            const m = await FS.lstat(path);
            if (!m.isDirectory() || m.isSymbolicLink() || m.uid !== process.getuid?.() || (m.mode & 0o077) !== 0)
                throw fail();
        }
        const source = await FS.open(executable, FSC.O_RDONLY | FSC.O_NOFOLLOW);
        try {
            const m = await source.stat();
            if (!m.isFile() || m.nlink !== 1 || m.uid !== process.getuid?.() || (m.mode & 0o777) !== 0o700 || m.size > 256 * 1024 * 1024)
                throw fail();
            const bytes = await readBounded(source, 256 * 1024 * 1024);
            if (Crypto.createHash('sha256').update(bytes).digest('hex') !== binding.selfSha256)
                throw fail();
        }
        finally {
            await source.close();
        }
        // Fixed native binary/argv; no helper path/env authority supplied by service.env.
        const child = CP.spawn(executable, ['__blackcrab-service-issuer-v1'], { cwd: owner, env: { PATH: '/usr/bin:/bin', HOME: owner, TMPDIR: owner }, stdio: ['pipe', 'pipe', 'pipe'] });
        const peer = new OwnedLauncherBootstrap(child, binding as unknown as NativeBinding, baseDir, 1, onFailure);
        try {
            const ready = await peer.#wait(120000);
            if (!keys(ready, ['type', 'protocol', 'generation', 'nextEpoch', 'manifestSha256', 'environmentId', 'version']) || ready.type !== 'ready' || ready.protocol !== 1 || ready.generation !== binding.generation || !safe(ready.nextEpoch) || ready.manifestSha256 !== binding.manifestSha256 || ready.environmentId !== binding.environmentId || ready.version !== binding.version)
                throw fail();
            peer.#epoch = ready.nextEpoch;
            peer.#armed = true;
            return peer;
        }
        catch {
            await peer.close().catch(() => undefined);
            throw fail();
        }
    }
    #fatal() {
        if (this.#closed)
            return;
        this.#closed = true;
        const pending = this.#pending;
        this.#pending = undefined;
        if (pending) {
            clearTimeout(pending.timer);
            pending.reject(fail());
        }
        if (this.#armed) this.#onFailure(fail());
    }
    #receive(raw: Buffer) {
        this.#total += raw.length;
        if (this.#closed || this.#total > 16 * 1024 * 1024 || this.#buffer.length + raw.length > LIMIT) {
            this.#fatal();
            return;
        }
        this.#buffer = Buffer.concat([this.#buffer, raw]);
        const newline = this.#buffer.indexOf(10);
        if (newline < 0)
            return;
        if (newline !== this.#buffer.length - 1 || !this.#pending) {
            this.#fatal();
            return;
        }
        let value: unknown;
        try {
            value = JSON.parse(this.#buffer.toString());
        }
        catch {
            this.#fatal();
            return;
        }
        this.#buffer = Buffer.alloc(0);
        if (!record(value)) {
            this.#fatal();
            return;
        }
        const pending = this.#pending;
        this.#pending = undefined;
        clearTimeout(pending.timer);
        pending.resolve(value);
    }
    #wait(timeout: number): Promise<Record<string, unknown>> {
        if (this.#closed || this.#pending)
            return Promise.reject(fail());
        return new Promise((resolve, reject) => { const timer = setTimeout(() => this.#fatal(), timeout); this.#pending = { resolve, reject, timer }; });
    }
    #request(value: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (this.#closed || this.#pending)
            return Promise.reject(fail());
        const bytes = Buffer.from(JSON.stringify(value) + '\n');
        this.#total += bytes.length;
        if (bytes.length > LIMIT || this.#total > 16 * 1024 * 1024)
            return Promise.reject(fail());
        const pending = this.#wait(30000);
        this.#child.stdin.write(bytes, error => { if (error)
            this.#fatal(); });
        return pending;
    }
    async prepare(version: string): Promise<Prepared> {
        if (this.#phase !== 'idle' || version !== this.#binding.version)
            throw fail();
        const manifestFile = await FS.open(Path.join(this.#baseDir, 'runtime', 'versions', version, 'payload', 'blackcrab-managed-host.json'), FSC.O_RDONLY | FSC.O_NOFOLLOW);
        let manifest: Buffer;
        try {
            const meta = await manifestFile.stat();
            if (!meta.isFile() || meta.nlink !== 1 || meta.size > 64 * 1024 * 1024)
                throw fail();
            manifest = await readBounded(manifestFile, 64 * 1024 * 1024);
        }
        finally {
            await manifestFile.close();
        }
        if (manifest.length > 64 * 1024 * 1024 || Crypto.createHash('sha256').update(manifest).digest('hex') !== this.#binding.manifestSha256)
            throw fail();
        const response = await this.#request({ type: 'begin', protocol: 1, epoch: this.#epoch, generation: this.#binding.generation });
        if (!keys(response, ['type', 'protocol', 'session', 'epoch', 'generation', 'envelope']) || response.type !== 'prepared' || response.protocol !== 1 || !hex(response.session) || response.epoch !== this.#epoch || response.generation !== this.#binding.generation || !record(response.envelope))
            throw fail();
        const envelope = response.envelope;
        const binding = envelope.binding;
        if (!keys(envelope, ['schema', 'kind', 'binding', 'desktopBootstrapToken', 'desktopBootstrapSecret']) || envelope.schema !== 1 || envelope.kind !== 'blackcrab-owned-service-auth-v1' || !hex(envelope.desktopBootstrapToken) || !hex(envelope.desktopBootstrapSecret) || !record(binding) || !keys(binding, ['profile', 'generation', 'manifestSha256', 'environmentId']) || binding.profile !== 'blackcrab-local-service-layout-v1' || binding.generation !== this.#binding.generation || binding.manifestSha256 !== this.#binding.manifestSha256 || binding.environmentId !== this.#binding.environmentId)
            throw fail();
        this.#session = response.session;
        this.#envelope = Buffer.from(JSON.stringify(envelope) + '\n');
        if (this.#envelope.length > 16384)
            throw fail();
        this.#phase = 'prepared';
        return { binding: Object.freeze({ ...binding }) as unknown as OwnedServiceBinding };
    }
    async deliver(child: CP.ChildProcess): Promise<void> {
        if (this.#phase !== 'prepared' || !child.stdin || !this.#envelope)
            throw fail();
        const bytes = this.#envelope;
        this.#envelope = undefined;
        // No retry on uncertain write; caller cleans only its captured child.
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(fail()), 1000);
            const failed = () => { clearTimeout(timer); reject(fail()); };
            child.stdin!.once('error', failed);
            child.stdin!.end(bytes, (error?: Error | null) => {
                clearTimeout(timer);
                if (error)
                    reject(fail());
                else
                    resolve();
            });
        });
        const response = await this.#request({ type: 'issued', protocol: 1, epoch: this.#epoch, session: this.#session });
        if (!keys(response, ['type', 'protocol', 'epoch']) || response.type !== 'issued' || response.protocol !== 1 || response.epoch !== this.#epoch)
            throw fail();
        this.#phase = 'issued';
    }
    async retire(): Promise<void> {
        if (this.#phase === 'idle')
            return;
        if (this.#phase !== 'issued')
            throw fail();
        const response = await this.#request({ type: 'retire', protocol: 1, epoch: this.#epoch, session: this.#session });
        if (!keys(response, ['type', 'protocol', 'epoch']) || response.type !== 'retired' || response.protocol !== 1 || response.epoch !== this.#epoch || this.#epoch === Number.MAX_SAFE_INTEGER)
            throw fail();
        this.#epoch++;
        this.#phase = 'idle';
        this.#session = undefined;
    }
    async close(): Promise<void> {
        const child = this.#child;
        this.#closed = true;
        if (this.#pending) {
            clearTimeout(this.#pending.timer);
            this.#pending.reject(fail());
            this.#pending = undefined;
        }
        this.#envelope = undefined;
        child.stdin.end();
        if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
            return;
        await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000); const deadline = setTimeout(() => reject(fail()), 5000); child.once('exit', () => { clearTimeout(timer); clearTimeout(deadline); resolve(); }); });
    }
}
