import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';

@UseGuards(JwtAuthGuard)
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  createTeam(@CurrentUser() user: JwtPayload, @Body() dto: CreateTeamDto) {
    return this.teamService.createTeam(user.sub, dto);
  }

  @Get('mine')
  listMyTeams(@CurrentUser() user: JwtPayload) {
    return this.teamService.listMyTeams(user.sub);
  }

  @Get(':teamId')
  getTeamDetail(
    @CurrentUser() user: JwtPayload,
    @Param('teamId') teamId: string,
  ) {
    return this.teamService.getTeamDetail(user.sub, teamId);
  }
}
