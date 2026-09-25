import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FormMateGenerationFailedException } from '../../common/exceptions/business.exception';
import { FormMateGeminiService } from './formmate-gemini.service';

interface GenerateContentCallArgs {
  model: string;
  contents: unknown;
  config: { maxOutputTokens?: number; responseSchema?: unknown };
}

const generateContentMock = jest.fn<
  Promise<{ text: string | undefined }>,
  [GenerateContentCallArgs]
>();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
  Type: new Proxy({}, { get: (_target, prop: string) => prop }),
}));

describe('FormMateGeminiService', () => {
  let service: FormMateGeminiService;
  let configService: { getOrThrow: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    generateContentMock.mockReset();
    configService = {
      getOrThrow: jest.fn().mockReturnValue('fake-api-key'),
      get: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormMateGeminiService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<FormMateGeminiService>(FormMateGeminiService);
  });

  // Fix: 생성자에서 즉시 GoogleGenAI를 만들면 GEMINI_API_KEY가 없는 환경(로컬
  // 개발/테스트/FormMate를 안 쓰는 배포)에서 이 서비스 하나 때문에 전체
  // 모듈 부트스트랩이 실패한다 — 실제로 호출할 때만 실패하도록 지연시켰다.
  it('does not read GEMINI_API_KEY until generateReply is actually called', () => {
    expect(configService.getOrThrow).not.toHaveBeenCalled();
  });

  it('reads GEMINI_API_KEY lazily on first generateReply call', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ replyText: '안녕하세요', changes: [] }),
    });

    await service.generateReply('system', []);

    expect(configService.getOrThrow).toHaveBeenCalledWith('GEMINI_API_KEY');
  });

  it('reuses the same client across calls instead of recreating it', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ replyText: 'ok', changes: [] }),
    });

    await service.generateReply('system', []);
    await service.generateReply('system', []);

    expect(configService.getOrThrow).toHaveBeenCalledTimes(1);
  });

  it('throws FormMateGenerationFailedException when Gemini returns no text', async () => {
    generateContentMock.mockResolvedValue({ text: undefined });

    await expect(service.generateReply('system', [])).rejects.toBeInstanceOf(
      FormMateGenerationFailedException,
    );
  });

  it('throws FormMateGenerationFailedException when the response is not valid JSON', async () => {
    generateContentMock.mockResolvedValue({
      text: '{ "replyText": "잘린 응답", "changes": [', // truncated/invalid JSON
    });

    await expect(service.generateReply('system', [])).rejects.toBeInstanceOf(
      FormMateGenerationFailedException,
    );
  });

  it('passes maxOutputTokens and the structured responseSchema on every call', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ replyText: 'ok', changes: [] }),
    });

    await service.generateReply('system', []);

    const call = generateContentMock.mock.calls[0][0];
    expect(call.config.maxOutputTokens).toEqual(expect.any(Number));
    expect(call.config.responseSchema).toBeDefined();
  });
});
