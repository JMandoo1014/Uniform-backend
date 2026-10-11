import { maskEmail, maskEmailsInText } from './mask.util';

describe('maskEmail', () => {
  it.each([
    ['abcdef@domain.com', 'ab***@domain.com'],
    ['abc@domain.com', 'ab***@domain.com'],
    ['ab@domain.com', 'a***@domain.com'],
    ['a@domain.com', 'a***@domain.com'],
    ['not-an-email', '***'],
    ['@domain.com', '***'],
  ])('%s → %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});

describe('maskEmailsInText', () => {
  it('masks every address inside an SMTP error message', () => {
    expect(
      maskEmailsInText(
        '550 5.1.1 <someone@example.com>: Recipient address rejected (from noreply@uniform-app.com)',
      ),
    ).toBe(
      '550 5.1.1 <so***@example.com>: Recipient address rejected (from no***@uniform-app.com)',
    );
  });
});
