import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

  // 운영/개발 구분 없이 항상 열어둔다 — 문서만 보이는 것이고 실제 호출은 여전히
  // JWT가 필요하므로 문제없다는 결정.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Uni-Form API')
    .setDescription(
      '대학(원)생 대상 설문조사 플랫폼 Uni-Form의 백엔드 API 문서',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
