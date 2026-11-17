import { SetMetadata } from '@nestjs/common';

export const IS_ADMIN_ONLY = 'front-burner:admin-only';

/**
 * Limits a route, or every route of a controller, to administrators (A-7.4).
 * The global admin guard answers `403 forbidden` to anyone else, after the
 * auth guard has answered `401` to a request without a valid auth token.
 */
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(IS_ADMIN_ONLY, true);
