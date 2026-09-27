import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './guards/admin.guard';
import { AdminAuditService } from './admin-audit.service';
import { AdminMembersService } from './admin-members.service';
import { AdminRewardsService } from './admin-rewards.service';
import { AdminSummaryService } from './admin-summary.service';
import { AdminSurveysService } from './admin-surveys.service';
import { AdminTeamsService } from './admin-teams.service';

@Module({
  imports: [MailModule],
  controllers: [AdminController],
  providers: [
    AdminGuard,
    AdminAuditService,
    AdminRewardsService,
    AdminSurveysService,
    AdminMembersService,
    AdminTeamsService,
    AdminSummaryService,
  ],
})
export class AdminModule {}
