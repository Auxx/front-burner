import { Injectable, OnModuleInit } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * Hashes passwords with Argon2id and a fresh salt each time (PP-12). Every
 * password is normalised to NFC first, and never trimmed, so that the same
 * password typed on any device matches (PP-1, PP-2).
 */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  private dummyHash: Promise<string> | undefined;

  /** Computes the dummy hash at startup, so that the first login without a hash costs the same. */
  onModuleInit(): void {
    void this.dummy();
  }

  hash(password: string): Promise<string> {
    return hash(password.normalize('NFC'), { type: argon2id });
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password.normalize('NFC'));
  }

  /**
   * Runs a check of the same cost as {@link verify} when there is no hash to
   * check against, so that the response time does not tell why a login failed (LG-15).
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    await this.verify(await this.dummy(), password);
    return false;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    return this.dummyHash;
  }
}
