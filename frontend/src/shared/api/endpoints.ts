/**
 * Все эндпоинты бэкенда — единая таблица истины.
 * Используй `EP.xxx` вместо строчных путей в коде.
 *
 * Порт из vanilla + подтверждено чтением `backend/src/routes/*`.
 *
 * ВАЖНО: не добавляй новые эндпоинты без обновления бэкенда.
 */

export const EP = {
  // ── Auth ──────────────────────────────────
  authCheck: '/auth/check',
  authLogin: '/auth/login',
  authLogout: '/auth/logout',
  authLogoutAll: '/auth/logout-all',
  authChangePin: '/auth/change-pin',
  authVerifyDevice: '/auth/verify-device',
  authSetSecurityQuestion: '/auth/set-security-question',
  authSecurityStatus: '/auth/security-status',
  authRevokeDevice: '/auth/revoke-device',

  // ── WebAuthn (Face ID / Touch ID / Windows Hello) ──
  webauthnRegisterOptions: '/webauthn/register/options',
  webauthnRegisterVerify: '/webauthn/register/verify',
  webauthnLoginOptions: '/webauthn/login/options',
  webauthnLoginVerify: '/webauthn/login/verify',
  webauthnCredentials: '/webauthn/credentials',
  webauthnCredentialItem: (id: number) => `/webauthn/credentials/${id}`,
  webauthnAvailable: '/webauthn/available',

  // ── Patients ──────────────────────────────
  patient: '/patient',
  patientList: '/patient/list',
  patientContext: '/patient-context',

  // ── Dashboard ─────────────────────────────
  dashboard: '/dashboard',
  dashboardAiSummary: '/dashboard/ai-summary',

  // ── Plan ──────────────────────────────────
  plan: '/plan',
  planItem: (id: number) => `/plan/${id}`,

  // ── Errors ────────────────────────────────
  errors: '/errors',
  errorItem: (id: number) => `/errors/${id}`,

  // ── Timeline (visits) ─────────────────────
  timeline: '/timeline',
  timelineItem: (id: number) => `/timeline/${id}`,

  // ── Documents ─────────────────────────────
  documents: '/documents',
  documentItem: (id: number) => `/documents/${id}`,
  documentFile: (id: number) => `/documents/${id}/file`,

  // ── Diagnoses ─────────────────────────────
  diagnoses: '/diagnoses',
  diagnosisItem: (id: number) => `/diagnoses/${id}`,

  // ── Medications ───────────────────────────
  medications: '/medications',
  medicationItem: (id: number) => `/medications/${id}`,

  // ── Specialists ───────────────────────────
  specialists: '/specialists',
  specialistItem: (id: number) => `/specialists/${id}`,

  // ── Vaccinations ──────────────────────────
  vaccinations: '/vaccinations',
  vaccinationItem: (id: number) => `/vaccinations/${id}`,
  vaccinationPhotos: (id: number) => `/vaccinations/${id}/photos`,
  vaccinationsSectionPhotos: '/vaccinations/section-photos',

  // ── Growth ────────────────────────────────
  growth: '/growth',
  growthItem: (id: number) => `/growth/${id}`,

  // ── Lab Results ───────────────────────────
  labResults: '/lab-results',
  labResultItem: (id: number) => `/lab-results/${id}`,

  // ── Reminders ─────────────────────────────
  reminders: '/reminders',
  reminderItem: (id: number) => `/reminders/${id}`,

  // ── Comments ──────────────────────────────
  comments: '/comments',
  commentItem: (id: number) => `/comments/${id}`,

  // ── AI Requests ───────────────────────────
  aiRequests: '/ai-requests',

  // ── Search ────────────────────────────────
  search: (q: string) => `/search?q=${encodeURIComponent(q)}`,

  // ── Version (legacy, app_versions manual) ─
  version: '/version',
  changelog: '/changelog',

  // ── History (automatic audit_log per patient) ─
  history: '/history',

  // ── Export ────────────────────────────────
  exportPdf: '/export/pdf',
} as const;
