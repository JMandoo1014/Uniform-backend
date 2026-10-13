import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { TeamModule } from './team/team.module';
import { SurveyModule } from './survey/survey.module';
import { ResponseModule } from './response/response.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { ResultModule } from './result/result.module';
import { MypageModule } from './mypage/mypage.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SupportModule } from './support/support.module';
import { AdminModule } from './admin/admin.module';
import { RetentionModule } from './retention/retention.module';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard';
import { THROTTLERS } from './common/throttler/throttle.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // 저장소는 기본 메모리 — PM2 단일 프로세스 기준. 여러 프로세스로 늘리면 공유 저장소가 필요하다.
    ThrottlerModule.forRoot({ throttlers: THROTTLERS }),
    PrismaModule,
    AuthModule,
    UserModule,
    TeamModule,
    SurveyModule,
    ResponseModule,
    LeaderboardModule,
    ResultModule,
    MypageModule,
    DashboardModule,
    SupportModule,
    AdminModule,
    RetentionModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
