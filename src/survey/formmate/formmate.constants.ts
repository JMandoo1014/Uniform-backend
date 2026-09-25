// Spec 4.2: Gemini에게 넘기는 대화 컨텍스트는 최근 N개 메시지로 제한한다.
export const FORMMATE_RECENT_MESSAGE_LIMIT = 20;

// 답변 + 여러 개의 제안 변경까지 담기에 넉넉하면서도, 응답이 끝없이 길어지는
// 걸 막는 상한. 이 값 때문에 응답이 잘리면 JSON.parse가 실패하고
// FormMateGenerationFailedException으로 이어진다.
export const FORMMATE_MAX_OUTPUT_TOKENS = 8192;

// 메시지당 외부 유료 API 호출이 붙으므로 다른 자유 텍스트 필드보다 길이를
// 더 짧게 제한한다.
export const FORMMATE_MESSAGE_MAX_LENGTH = 2000;
