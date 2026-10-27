import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { GeneratedSshKey, SavedCredentials, SavedSshKey } from '@front-burner/shared-contracts';
import { CredentialsApi } from '@front-burner/web-api-client';
import { of, Subject, throwError } from 'rxjs';

import { SessionKeysService } from './session-keys.service';

const locked: SavedSshKey = {
  id: 3,
  name: 'Laptop',
  keyType: 'ed25519',
  fingerprint: 'SHA256:locked',
  passphraseProtected: true,
  unlocked: false,
  generated: false,
  missing: false
};

const generated: GeneratedSshKey = {
  key: { ...locked, id: 9, name: 'Front Burner', passphraseProtected: false, generated: true },
  publicKey: 'ssh-ed25519 AAAA front-burner@example.com'
};

const saved: SavedCredentials = { https: [], sshKeys: [ locked ] };

describe('SessionKeysService', () => {
  let api: { generateSshKey: ReturnType<typeof vi.fn>; unlockSshKey: ReturnType<typeof vi.fn>; };
  let service: SessionKeysService;

  beforeEach(() => {
    api = { generateSshKey: vi.fn(() => of(generated)), unlockSshKey: vi.fn(() => of(undefined)) };
    TestBed.configureTestingModule({ providers: [ SessionKeysService, { provide: CredentialsApi, useValue: api } ] });
    service = TestBed.inject(SessionKeysService);
  });

  it('adds the generated key to the saved keys', async () => {
    await service.generate('Front Burner');

    expect(api.generateSshKey).toHaveBeenCalledWith({ name: 'Front Burner' });
    expect(service.generated()).toEqual(generated);
    expect(service.withSessionKeys(saved).sshKeys).toEqual([ locked, generated.key ]);
  });

  it('does not add the generated key twice once the list has it', async () => {
    await service.generate('Front Burner');

    expect(service.withSessionKeys({ https: [], sshKeys: [ generated.key ] }).sshKeys).toEqual([ generated.key ]);
  });

  it('generates a key at most once per visit', async () => {
    await service.generate('Front Burner');

    await expect(service.generate('Another')).rejects.toThrow();
    expect(api.generateSshKey).toHaveBeenCalledTimes(1);
  });

  it('marks a key unlocked for this session once the passphrase is right', async () => {
    await service.unlock(3, 'correct horse');

    expect(api.unlockSshKey).toHaveBeenCalledWith(3, { passphrase: 'correct horse' });
    expect(service.withSessionKeys(saved).sshKeys[0].unlocked).toBe(true);
  });

  it('leaves a key locked after a wrong passphrase', async () => {
    api.unlockSshKey.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422 })));

    await expect(service.unlock(3, 'wrong')).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(service.withSessionKeys(saved).sshKeys[0].unlocked).toBe(false);
  });

  it('is busy while a request runs', async () => {
    const answer = new Subject<void>();
    api.unlockSshKey.mockReturnValue(answer);

    const unlocking = service.unlock(3, 'correct horse');
    expect(service.busy()).toBe(true);
    answer.next();
    answer.complete();
    await unlocking;

    expect(service.busy()).toBe(false);
  });
});
