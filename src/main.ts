import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 프론트(Vite dev server 등 다른 origin)에서 API를 직접 호출할 수 있도록 허용.
  // CORS_ORIGIN을 쉼표로 구분해 지정하면 그 목록만 허용하고, 안 정해져 있으면
  // 개발 편의를 위해 모든 origin을 허용한다(인증은 쿠키가 아니라 Authorization
  // 헤더의 Bearer 토큰을 쓰므로 credentials는 필요 없다).
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',') : true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
