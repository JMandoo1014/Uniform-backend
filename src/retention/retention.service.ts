import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InquiryStatus, Prisma, UserStatus } from '@prisma/client';
import {
  ADMIN_LOG_PERSONAL_DATA_RETENTION_DAYS,
  ANSWERED_INQUIRY_RETENTION_DAYS,
  DAY_MS,
  UNVERIFIED_ACCOUNT_TTL_DAYS,
  WITHDRAWN_EMAIL_BLOCK_DAYS,
} from '../common/constants/retention.constant';
import { toKstDateString } from '../common/utils/kst-date.util';
import { PrismaService } from '../prisma/prisma.service';

export const RETENTION_JOB_NAME = 'privacy-retention';
// 매일 04:00 KST — 사용량이 가장 적은 시간대.
const RETENTION_CRON = '0 0 4 * * *';

// RETENTION_DISABLED_JOBS(쉼표 구분)에 쓰는 이름이자 로그 접두어.
export const RETENTION_JOB_IDS = [
  'survey-purge',
  'unverified-accounts',
  'withdrawn-emails',
  'answered-inquiries',
  'admin-log-scrub',
] as const;
export type RetentionJobId = (typeof RETENTION_JOB_IDS)[number];

export type RetentionJobSummary = Record<string, number>;
export type RetentionJobOutcome =
  RetentionJobSummary | { error: string } | { disabled: true };
export type RetentionRunResult =
  | { status: 'skipped' }
  | {
      status: 'completed';
      dryRun: boolean;
      jobs: Record<RetentionJobId, RetentionJobOutcome>;
    };

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(RETENTION_CRON, {
    name: RETENTION_JOB_NAME,
    timeZone: 'Asia/Seoul',
  })
  async handleCron(): Promise<void> {
    await this.runOnce(new Date());
  }

  // 처음 운영에 켤 때는 RETENTION_DRY_RUN=true로 대상 건수만 로그로 확인한다.
  isDryRun(): boolean {
    return this.configService.get<string>('RETENTION_DRY_RUN') === 'true';
  }

  // 작업별로 끈다(예: 확정 집계 스냅샷이 생기기 전까지 survey-purge). 모르는
  // 이름은 오타일 가능성이 높아 경고만 남기고 무시한다.
  getDisabledJobs(): Set<RetentionJobId> {
    const raw = this.configService.get<string>('RETENTION_DISABLED_JOBS') ?? '';
    const names = raw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const known = new Set<string>(RETENTION_JOB_IDS);
    const unknown = names.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      this.logger.warn(
        `RETENTION_DISABLED_JOBS에 알 수 없는 작업 이름이 있어 무시합니다: ${unknown.join(', ')} ` +
          `(사용 가능: ${RETENTION_JOB_IDS.join(', ')})`,
      );
    }
    return new Set(names.filter((name) => known.has(name)) as RetentionJobId[]);
  }

  async runOnce(now: Date): Promise<RetentionRunResult> {
    const dryRun = this.isDryRun();
    const runDate = toKstDateString(now);

    // 여러 인스턴스가 동시에 깨어나도 (jobName, runDate) 행을 먼저 만든 쪽만
    // 실행한다. 실행 도중 죽으면 그날은 건너뛰고 다음 날 다시 돈다 — 모든
    // 작업이 "기준 시각이 지난 것"을 지우는 방식이라 하루 늦어도 결과는 같다.
    try {
      await this.prisma.scheduledJobRun.create({
        data: { jobName: RETENTION_JOB_NAME, runDate, dryRun },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.log(
          `${runDate} 정리 배치는 이미 다른 인스턴스가 실행했습니다 — 건너뜁니다.`,
        );
        return { status: 'skipped' };
      }
      throw error;
    }

    this.logger.log(
      `${runDate} 정리 배치 시작${dryRun ? ' [dry-run: 삭제하지 않고 대상 건수만 기록]' : ''}`,
    );

    const steps: Record<
      RetentionJobId,
      (now: Date, dryRun: boolean) => Promise<RetentionJobSummary>
    > = {
      'survey-purge': (n, d) => this.purgeSurveyResponses(n, d),
      'unverified-accounts': (n, d) => this.deleteUnverifiedAccounts(n, d),
      'withdrawn-emails': (n, d) => this.deleteExpiredWithdrawnEmails(n, d),
      'answered-inquiries': (n, d) => this.deleteAnsweredInquiries(n, d),
      'admin-log-scrub': (n, d) => this.scrubAdminLogPersonalData(n, d),
    };
    const disabled = this.getDisabledJobs();
    const jobs = {} as Record<RetentionJobId, RetentionJobOutcome>;
    // 한 작업이 실패해도 나머지는 계속 돈다.
    for (const id of RETENTION_JOB_IDS) {
      if (disabled.has(id)) {
        jobs[id] = { disabled: true };
        this.logger.log(
          `[${id}] disabled (RETENTION_DISABLED_JOBS) — 실행하지 않음`,
        );
        continue;
      }
      try {
        jobs[id] = await steps[id](now, dryRun);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jobs[id] = { error: message };
        this.logger.error(`[${id}] 실패: ${message}`);
      }
    }

    await this.prisma.scheduledJobRun.update({
      where: { jobName_runDate: { jobName: RETENTION_JOB_NAME, runDate } },
      data: { finishedAt: new Date() },
    });
    this.logger.log(`${runDate} 정리 배치 종료`);
    return { status: 'completed', dryRun, jobs };
  }

  // a. Spec 7.4: 마감 30일 뒤(purgeAt) 응답 원문을 파기한다. 응답 세션·문항·
  // 설문·리더보드 점수는 남긴다(응답 수·점수 기록·마이페이지 제목/제출일 유지).
  // FormMate 대화는 초안 작성 보조 기록이라 함께 지운다(제안은 메시지 cascade).
  async purgeSurveyResponses(
    now: Date,
    dryRun: boolean,
  ): Promise<RetentionJobSummary> {
    const surveyWhere: Prisma.SurveyWhereInput = { purgeAt: { lte: now } };
    const answerWhere: Prisma.SessionAnswerWhereInput = {
      session: { survey: surveyWhere },
    };
    const messageWhere: Prisma.FormMateMessageWhereInput = {
      survey: surveyWhere,
    };
    const changeWhere: Prisma.FormMateProposedChangeWhereInput = {
      survey: surveyWhere,
    };

    const count = () =>
      Promise.all([
        this.prisma.sessionAnswer.count({ where: answerWhere }),
        this.prisma.formMateMessage.count({ where: messageWhere }),
        this.prisma.formMateProposedChange.count({ where: changeWhere }),
      ]);

    const surveys = await this.prisma.survey.count({ where: surveyWhere });
    const [answersBefore, messagesBefore, changesBefore] = await count();

    if (!dryRun) {
      await this.prisma.$transaction([
        this.prisma.sessionAnswer.deleteMany({ where: answerWhere }),
        this.prisma.formMateProposedChange.deleteMany({ where: changeWhere }),
        this.prisma.formMateMessage.deleteMany({ where: messageWhere }),
      ]);
    }
    const [answersAfter, messagesAfter, changesAfter] = dryRun
      ? [answersBefore, messagesBefore, changesBefore]
      : await count();

    this.logger.log(
      `[survey-purge] 파기 시점 지난 설문 ${surveys}개 — ` +
        `답변 원문 ${answersBefore}→${answersAfter}, ` +
        `FormMate 메시지 ${messagesBefore}→${messagesAfter}, ` +
        `FormMate 제안 ${changesBefore}→${changesAfter}`,
    );
    return {
      surveys,
      answersBefore,
      answersAfter,
      messagesBefore,
      messagesAfter,
      changesBefore,
      changesAfter,
    };
  }

  // b. Spec 2.2: 인증 대기 7일이 지나면 가입 정보를 지우고 닉네임 선점을 푼다.
  // 팀장·관리자 기록처럼 Restrict FK로 묶인 계정은 인증 대기 상태에서 생길 수
  // 없지만, 혹시 있으면 배치 전체가 실패하지 않도록 대상에서 뺀다.
  async deleteUnverifiedAccounts(
    now: Date,
    dryRun: boolean,
  ): Promise<RetentionJobSummary> {
    const where: Prisma.UserWhereInput = {
      status: UserStatus.PENDING_VERIFICATION,
      createdAt: {
        lte: new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_DAYS * DAY_MS),
      },
      ledTeams: { none: {} },
      adminActionLogs: { none: {} },
      restrictionsIssued: { none: {} },
    };
    return this.deleteWhere(
      'unverified-accounts',
      `인증 대기 ${UNVERIFIED_ACCOUNT_TTL_DAYS}일 지난 회원`,
      dryRun,
      () => this.prisma.user.count({ where }),
      () => this.prisma.user.deleteMany({ where }),
    );
  }

  // c. Spec 2.5: 재가입 차단 기간이 끝난 탈퇴 이메일 해시. HMAC 도입 전
  // (솔트 없는 SHA-256) 행도 같은 기준으로 여기서 정리된다.
  async deleteExpiredWithdrawnEmails(
    now: Date,
    dryRun: boolean,
  ): Promise<RetentionJobSummary> {
    const where: Prisma.WithdrawnEmailWhereInput = {
      withdrawnAt: {
        lte: new Date(now.getTime() - WITHDRAWN_EMAIL_BLOCK_DAYS * DAY_MS),
      },
    };
    return this.deleteWhere(
      'withdrawn-emails',
      `탈퇴 ${WITHDRAWN_EMAIL_BLOCK_DAYS}일 지난 이메일 해시`,
      dryRun,
      () => this.prisma.withdrawnEmail.count({ where }),
      () => this.prisma.withdrawnEmail.deleteMany({ where }),
    );
  }

  // d-1. 처리 완료 후 보유 기간이 지난 문의.
  async deleteAnsweredInquiries(
    now: Date,
    dryRun: boolean,
  ): Promise<RetentionJobSummary> {
    const where: Prisma.InquiryWhereInput = {
      status: InquiryStatus.ANSWERED,
      answeredAt: {
        lte: new Date(now.getTime() - ANSWERED_INQUIRY_RETENTION_DAYS * DAY_MS),
      },
    };
    return this.deleteWhere(
      'answered-inquiries',
      `처리 완료 후 ${ANSWERED_INQUIRY_RETENTION_DAYS}일 지난 문의`,
      dryRun,
      () => this.prisma.inquiry.count({ where }),
      () => this.prisma.inquiry.deleteMany({ where }),
    );
  }

  // d-2. Spec 10.1 "기록하고 지우지 않는다" — 행은 남기고(조치자·시각·대상
  // id·사유), 당시 닉네임·문의 제목·추첨 대상 닉네임 등이 들어가는
  // targetName/memo/beforeValue/afterValue만 비운다.
  async scrubAdminLogPersonalData(
    now: Date,
    dryRun: boolean,
  ): Promise<RetentionJobSummary> {
    const where: Prisma.AdminActionLogWhereInput = {
      createdAt: {
        lte: new Date(
          now.getTime() - ADMIN_LOG_PERSONAL_DATA_RETENTION_DAYS * DAY_MS,
        ),
      },
      OR: [
        { targetName: { not: null } },
        { memo: { not: null } },
        { beforeValue: { not: null } },
        { afterValue: { not: null } },
      ],
    };
    return this.deleteWhere(
      'admin-log-scrub',
      `${ADMIN_LOG_PERSONAL_DATA_RETENTION_DAYS}일 지난 관리자 조치 기록의 개인정보 필드`,
      dryRun,
      () => this.prisma.adminActionLog.count({ where }),
      () =>
        this.prisma.adminActionLog.updateMany({
          where,
          data: {
            targetName: null,
            memo: null,
            beforeValue: null,
            afterValue: null,
          },
        }),
    );
  }

  private async deleteWhere(
    name: string,
    label: string,
    dryRun: boolean,
    count: () => Promise<number>,
    apply: () => Promise<{ count: number }>,
  ): Promise<RetentionJobSummary> {
    const before = await count();
    const affected = dryRun || before === 0 ? 0 : (await apply()).count;
    const after = dryRun ? before : await count();
    this.logger.log(
      `[${name}] ${label}: 대상 ${before}건, 처리 ${affected}건, 남은 대상 ${after}건`,
    );
    return { before, affected, after };
  }
}
