import { User } from '@prisma/client';

export class UserResponseDto {
  id: string;
  email: string;
  nickname: string;
  gender: User['gender'];
  grade: User['grade'];
  majorField: User['majorField'];
  enrollmentStatus: User['enrollmentStatus'];
  marketingOptIn: boolean;
  status: User['status'];
  createdAt: Date;

  constructor(user: User) {
    this.id = user.id;
    this.email = user.email;
    this.nickname = user.nickname;
    this.gender = user.gender;
    this.grade = user.grade;
    this.majorField = user.majorField;
    this.enrollmentStatus = user.enrollmentStatus;
    this.marketingOptIn = user.marketingOptIn;
    this.status = user.status;
    this.createdAt = user.createdAt;
  }
}
