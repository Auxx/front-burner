export { isRefusal } from './core/errors/is-refusal';
export { toApiError } from './core/errors/to-api-error';
export { authGuard, guestGuard } from './core/guards/auth/auth.guard';
export { onboardingDestination, onboardingGuard } from './core/guards/onboarding/onboarding.guard';
export { TranslocoHttpLoader } from './core/i18n/transloco-http.loader';
export type { LoginMessage } from './core/models/login-message.model';
export { provideCore } from './core/providers/provide-core';
export { PageTitleStrategy } from './core/routing/page-title.strategy';
export { type Draft, type DraftKey, DraftStore } from './core/saving/draft-store';
export { FileSaver, type FileSaverOptions, SAVE_DELAY_MS, SAVE_RETRY_DELAYS_MS } from './core/saving/file-saver';
export type { SaveResult, SaveStatus } from './core/saving/save-status.model';
export { type ApiErrorText, ApiErrorTextService } from './core/services/api-error-text/api-error-text.service';
export { AuthSessionService, type SessionEnd } from './core/services/auth-session/auth-session.service';
export { CurrentUserService } from './core/services/current-user/current-user.service';
export { OnboardingStateService, type OnboardingView } from './core/services/onboarding-state/onboarding-state.service';
export { OnlineStatusService } from './core/services/online-status/online-status.service';
export { ownsTitle, PageTitleService } from './core/services/page-title/page-title.service';
export { PushChannelService } from './core/services/push-channel/push-channel.service';
export {
  RemovedRepositoriesService,
  type RemovedRepositoryViewer
} from './core/services/removed-repositories/removed-repositories.service';
export {
  type BeforeReload,
  PAGE_RELOAD,
  VersionCheckService
} from './core/services/version-check/version-check.service';
export { APP_VERSION } from './core/tokens/app-version';
export { fieldErrorCode } from './core/utils/field-error-code/field-error-code';
export { isRepositoryId } from './core/utils/is-repository-id/is-repository-id';
export { relativeTime } from './core/utils/relative-time/relative-time';
export { safeReturnUrl } from './core/utils/safe-return-url/safe-return-url';
