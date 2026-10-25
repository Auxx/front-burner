import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

/**
 * Hashes passwords with Argon2id and a fresh salt each time (PP-12). Every
 * password is normalised to NFC first, and never trimmed, so that the same
 * password typed on any device matches (PP-1, PP-2).
 */
@Injectable()
export class PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password.normalize('NFC'), { type: argon2id });
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password.normalize('NFC'));
  }
}
