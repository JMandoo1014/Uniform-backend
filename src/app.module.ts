import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { TeamModule } from './team/team.module';
import { SurveyModule } from './survey/survey.module';
import { ResponseModule } from './response/response.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { ResultModule } from './result/result.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UserModule,
    TeamModule,
    SurveyModule,
    ResponseModule,
    LeaderboardModule,
    ResultModule,
  ],
})
export class AppModule {}
