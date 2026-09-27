import { BadRequestException } from '@nestjs/common';

interface SurveyCursor {
  publishedAt: Date;
  id: string;
}

// Spec 5.2: 게시 시각 최신순, 같으면 내부 식별값(id) 내림차순 — 커서는 그
// 정렬 키(publishedAt, id) 쌍을 그대로 인코딩한다.
export function encodeSurveyCursor(survey: {
  publishedAt: Date;
  id: string;
}): string {
  return Buffer.from(
    `${survey.publishedAt.toISOString()}|${survey.id}`,
  ).toString('base64url');
}

export function decodeSurveyCursor(cursor: string): SurveyCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('유효하지 않은 cursor입니다.');
  }
  const [publishedAtRaw, id] = decoded.split('|');
  const publishedAt = publishedAtRaw ? new Date(publishedAtRaw) : null;
  if (!publishedAt || Number.isNaN(publishedAt.getTime()) || !id) {
    throw new BadRequestException('유효하지 않은 cursor입니다.');
  }
  return { publishedAt, id };
}
