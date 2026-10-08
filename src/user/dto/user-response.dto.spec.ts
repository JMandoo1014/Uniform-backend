import { User } from '@prisma/client';
import { UserResponseDto } from './user-response.dto';

function buildUser(agreedTermsVersion: string): User {
  return {
    id: 'user-1',
    agreedTermsVersion,
    termsAgreedAt: new Date('2026-09-02T00:00:00Z'),
    createdAt: new Date('2026-09-02T00:00:00Z'),
  } as User;
}

describe('UserResponseDto terms consent fields', () => {
  it('needs no consent when the agreed version is the current one', () => {
    const dto = new UserResponseDto(buildUser('2026-09-01'), '2026-09-01');

    expect(dto.currentTermsVersion).toBe('2026-09-01');
    expect(dto.needsTermsConsent).toBe(false);
    expect(dto.termsAgreedAt).toEqual(new Date('2026-09-02T00:00:00Z'));
  });

  it('needs consent when the terms changed after the user agreed', () => {
    const dto = new UserResponseDto(buildUser('2026-09-01'), '2026-10-15');

    expect(dto.needsTermsConsent).toBe(true);
  });
});
