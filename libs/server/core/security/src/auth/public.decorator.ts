import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { ACCESS_EXTENSION } from './access-extension';

export const IS_PUBLIC = 'front-burner:public';

/**
 * Opens a route, or every route of a controller, to requests without an auth
 * token. The OpenAPI document marks the route too, so that A-7.5's test finds
 * every public route and checks that each is meant to be one (A-7.2).
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC, true), ApiExtension(ACCESS_EXTENSION, 'public'));
