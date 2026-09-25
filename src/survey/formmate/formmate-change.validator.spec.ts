import { isValidQuestionDraft } from './formmate-change.validator';

describe('isValidQuestionDraft', () => {
  it('accepts a full question as Gemini returns it (nulls for unused fields)', () => {
    expect(
      isValidQuestionDraft({
        id: null,
        type: 'SINGLE_CHOICE',
        questionText: '학식을 얼마나 자주 이용하나요?',
        required: true,
        minSelect: null,
        maxSelect: null,
        minScaleLabel: null,
        maxScaleLabel: null,
        options: [
          { label: '매일', isEtc: null },
          { label: '기타', isEtc: true },
        ],
      }),
    ).toBe(true);
  });

  it('accepts a non-choice question without options', () => {
    expect(
      isValidQuestionDraft({ type: 'SHORT_ANSWER', questionText: '메뉴는?' }),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['missing type', { questionText: '질문' }],
    ['a non-creatable type', { type: 'ETC', questionText: '질문' }],
    ['missing questionText', { type: 'SHORT_ANSWER' }],
    ['blank questionText', { type: 'SHORT_ANSWER', questionText: '   ' }],
    [
      'a choice question without options',
      { type: 'MULTI_CHOICE', questionText: '질문' },
    ],
    [
      'an option without a label',
      { type: 'SINGLE_CHOICE', questionText: '질문', options: [{}] },
    ],
    [
      'a non-integer minSelect',
      {
        type: 'MULTI_CHOICE',
        questionText: '질문',
        minSelect: '1',
        options: [],
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isValidQuestionDraft(value)).toBe(false);
  });
});
