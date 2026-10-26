import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'front-burner:public';

/** Opens a route, or every route of a controller, to requests without an auth token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
