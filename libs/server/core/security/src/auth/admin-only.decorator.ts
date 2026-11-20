import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { ACCESS_EXTENSION } from './access-extension';

export const IS_ADMIN_ONLY = 'front-burner:admin-only';

/**
 * Limits a route, or every route of a controller, to administrators (A-7.4).
 * The global admin guard answers `403 forbidden` to anyone else, after the
 * auth guard has answered `401` to a request without a valid auth token.
 * The OpenAPI document marks the route too, so that A-7.5's test finds it.
 */
export const AdminOnly = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_ADMIN_ONLY, true), ApiExtension(ACCESS_EXTENSION, 'admin'));
