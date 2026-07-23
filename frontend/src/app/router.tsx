import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/shared/layout/AppShell';
import { RequireAuth } from '@/shared/auth/RequireAuth';
import { PinScreen } from '@/shared/auth/PinScreen';

import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PlanPage } from '@/features/plan/PlanPage';
import PlanItemModal from '@/features/plan/modals/PlanItemModal';
import { ErrorsPage } from '@/features/errors/ErrorsPage';
import ErrorModal from '@/features/errors/modals/ErrorModal';
import { DocumentsPage } from '@/features/documents/DocumentsPage';
import VisitDetailsModal from '@/features/documents/modals/VisitDetailsModal';
import VisitCreateModal from '@/features/documents/modals/VisitCreateModal';
import VisitEditModal from '@/features/documents/modals/VisitEditModal';
import TranscriptionModal from '@/features/documents/modals/TranscriptionModal';
import UploadDocumentModal from '@/features/documents/modals/UploadDocumentModal';
import DocumentDetailsModal from '@/features/documents/modals/DocumentDetailsModal';
import { DiagnosesPage } from '@/features/diagnoses/DiagnosesPage';
import DiagnosisModal from '@/features/diagnoses/modals/DiagnosisModal';
import { MorePage } from '@/features/more/MorePage';
import SpecialistsModal from '@/features/more/modals/SpecialistsModal';
import MedicationsModal from '@/features/more/modals/MedicationsModal';
import VaccinationsModal from '@/features/more/modals/VaccinationsModal';
import GrowthModal from '@/features/more/modals/GrowthModal';
import LabResultsModal from '@/features/more/modals/LabResultsModal';
import RemindersModal from '@/features/more/modals/RemindersModal';
import SearchModal from '@/features/more/modals/SearchModal';
import AiChatSheet from '@/features/more/modals/AiChatSheet';
import HistoryModal from '@/features/more/modals/HistoryModal';
import SecurityModal from '@/features/more/modals/SecurityModal';
import { HealthGraphPage } from '@/features/health-graph/HealthGraphPage';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const routerOpts: { basename?: string } = {};
if (basename !== '/') {
  routerOpts.basename = basename;
}

/**
 * Все роуты приложения.
 *
 * Модалки = child-роуты. Страницы рендерят `<Outlet />` где должны появляться
 * модалки. F5 сохраняет модалку. Back-кнопка закрывает модалку.
 */
export const router = createBrowserRouter(
  [
    { path: '/pin', Component: PinScreen },
    {
      path: '/',
      element: (
        <RequireAuth>
          <AppShell />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },

        { path: 'dashboard', Component: DashboardPage },

        {
          path: 'plan',
          Component: PlanPage,
          children: [{ path: ':itemId', Component: PlanItemModal }],
        },

        {
          path: 'errors',
          Component: ErrorsPage,
          children: [{ path: ':errorId', Component: ErrorModal }],
        },

        {
          path: 'documents',
          Component: DocumentsPage,
          children: [
            { path: 'new', Component: VisitCreateModal },
            { path: 'upload', Component: UploadDocumentModal },
            { path: 'doc/:docId', Component: DocumentDetailsModal },
            { path: 'visit/:visitId', Component: VisitDetailsModal },
            { path: 'visit/:visitId/edit', Component: VisitEditModal },
            { path: 'visit/:visitId/transcription', Component: TranscriptionModal },
          ],
        },

        {
          path: 'diagnoses',
          Component: DiagnosesPage,
          children: [{ path: ':id', Component: DiagnosisModal }],
        },

        {
          path: 'more',
          Component: MorePage,
          children: [
            { path: 'specialists', Component: SpecialistsModal },
            { path: 'medications', Component: MedicationsModal },
            { path: 'vaccinations', Component: VaccinationsModal },
            { path: 'growth', Component: GrowthModal },
            { path: 'labs', Component: LabResultsModal },
            { path: 'reminders', Component: RemindersModal },
            { path: 'search', Component: SearchModal },
            { path: 'ai-chat', Component: AiChatSheet },
            { path: 'history', Component: HistoryModal },
            { path: 'security', Component: SecurityModal },
          ],
        },

        { path: 'graph', Component: HealthGraphPage },
      ],
    },

    { path: '*', element: <Navigate to="/dashboard" replace /> },
  ],
  routerOpts
);
