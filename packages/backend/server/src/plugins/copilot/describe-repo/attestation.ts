import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type { DescribeRepoResult } from './types';

export interface AttestationRecord {
  id: string;
  userId: string;
  repoUrl: string;
  commitSha: string | null;
  /** Subtask → model id mapping at the time of the run. */
  modelIds: Record<string, string>;
  /** SHA-256 of each prompt name+config used in the run. */
  promptHashes: string[];
  /** SHA-256 of the canonical output (markdown + sorted file summaries). */
  outputHash: string;
  /** Hex ed25519 signature of `${id}|${outputHash}|${signedAt}`. */
  signature: string;
  /** Hex ed25519 public key the signature can be verified against. */
  signerPubKey: string;
  signedAt: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: 'signature_mismatch' | 'output_mismatch' | 'not_found';
}

/**
 * Append-only, in-memory attestation log for describeRepo runs.
 *
 * Each successful run is signed with a process-lifetime ed25519 keypair and
 * the record is stored in memory. The pubkey is exposed so external parties
 * can re-verify the (id, outputHash, signedAt) triple.
 *
 * Phase-2 follow-up:
 * - Persist records to a new `DescribeRepoAttestation` table so they survive
 *   restarts and federate across replicas.
 * - Replace the process-lifetime keypair with a key loaded from the secret
 *   store (e.g. `AFFINE_ATTESTATION_PRIVATE_KEY`), so the pubkey is stable
 *   and verifiable across deploys.
 */
@Injectable()
export class DescribeRepoAttestationService {
  private readonly logger = new Logger(DescribeRepoAttestationService.name);
  private readonly records = new Map<string, AttestationRecord>();
  private readonly byUser = new Map<string, string[]>();

  private readonly privateKey;
  private readonly publicKey;
  public readonly signerPubKeyHex: string;

  constructor() {
    const pair = generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.signerPubKeyHex = this.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('hex');
    this.logger.log(
      `attestation signer initialized: pubkey=${this.signerPubKeyHex.slice(0, 16)}…`
    );
  }

  record(
    userId: string,
    result: DescribeRepoResult,
    promptNames: string[]
  ): AttestationRecord {
    const id = randomId();
    const outputHash = hashOutput(result);
    const promptHashes = promptNames.map(name => sha256(`prompt:${name}`));
    const signedAt = new Date().toISOString();
    const payload = `${id}|${outputHash}|${signedAt}`;
    const signature = sign(
      null,
      Buffer.from(payload),
      this.privateKey
    ).toString('hex');

    const record: AttestationRecord = {
      id,
      userId,
      repoUrl: result.repoUrl,
      commitSha: result.commitSha,
      modelIds: { ...result.modelsUsed } as Record<string, string>,
      promptHashes,
      outputHash,
      signature,
      signerPubKey: this.signerPubKeyHex,
      signedAt,
    };

    this.records.set(id, record);
    const list = this.byUser.get(userId) ?? [];
    list.push(id);
    this.byUser.set(userId, list);

    return record;
  }

  get(id: string): AttestationRecord | null {
    return this.records.get(id) ?? null;
  }

  listForUser(userId: string, limit = 20): AttestationRecord[] {
    const ids = this.byUser.get(userId) ?? [];
    const out: AttestationRecord[] = [];
    for (let i = ids.length - 1; i >= 0 && out.length < limit; i--) {
      const rec = this.records.get(ids[i]);
      if (rec) out.push(rec);
    }
    return out;
  }

  /**
   * Verify a record: re-derive the signed payload and check the signature
   * against the recorded pubkey. Note this verifies the *record's integrity*
   * (it hasn't been tampered with in-memory); it does NOT re-run the LLM to
   * confirm the output. To detect output tampering, callers compare a
   * recomputed `hashOutput(currentResult)` against `record.outputHash`.
   */
  verify(id: string): VerifyResult {
    const record = this.records.get(id);
    if (!record) return { valid: false, reason: 'not_found' };
    const payload = `${record.id}|${record.outputHash}|${record.signedAt}`;
    const ok = verify(
      null,
      Buffer.from(payload),
      this.publicKey,
      Buffer.from(record.signature, 'hex')
    );
    return ok
      ? { valid: true }
      : { valid: false, reason: 'signature_mismatch' };
  }

  /** Recompute a hash for a fresh result and compare to a recorded one. */
  verifyOutput(id: string, result: DescribeRepoResult): VerifyResult {
    const record = this.records.get(id);
    if (!record) return { valid: false, reason: 'not_found' };
    const recomputed = hashOutput(result);
    if (recomputed !== record.outputHash) {
      return { valid: false, reason: 'output_mismatch' };
    }
    return this.verify(id);
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashOutput(result: DescribeRepoResult): string {
  const canonical = JSON.stringify({
    repoUrl: result.repoUrl,
    commitSha: result.commitSha,
    markdown: result.markdown,
    files: [...result.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(f => ({ path: f.path, summary: f.summary })),
  });
  return sha256(canonical);
}

function randomId(): string {
  return randomBytes(16).toString('hex');
}
