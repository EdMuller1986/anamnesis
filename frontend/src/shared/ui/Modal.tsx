import { useState, useCallback, type ReactNode } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { Sheet } from './Sheet';
import { useRouteModal } from '@/shared/hooks/useRouteModal';
import { useIsDesktop } from '@/shared/hooks/useMediaQuery';
import { haptic } from '@/shared/lib/haptic';

/**
 * Route-based модалка — wrapper над Sheet.
 *
 * ДВА ВАРИАНТА ОТОБРАЖЕНИЯ НА ДЕСКТОПЕ (`desktopStyle`):
 *
 * • 'overlay' (default) — centered dialog поверх страницы.
 *   Применяется когда parent-страница имеет содержательный контент
 *   (DocumentsPage, PlanPage, ErrorsPage — список + Outlet), и модалка
 *   открывается как pop-up.
 *
 * • 'page' — полноэкранная inline-страница внутри main area, без overlay.
 *   Применяется для /more/* разделов (Специалисты, Препараты, Анализы,
 *   AI чат, Поиск и т.д.), потому что на десктопе они концептуально
 *   самостоятельные экраны, а не модальные диалоги. MorePage на десктопе
 *   рендерит только <Outlet /> без menu.
 *
 * АНИМАЦИЯ ЗАКРЫТИЯ (mobile/overlay):
 * Локальное состояние `open`. При onClose → `setOpen(false)` → Sheet
 * запускает exit-анимацию (spring) → через ~320ms делаем реальный
 * `navigate('..')`. Это нужно чтобы анимация успела сыграть до
 * размонтирования компонента.
 */

const EXIT_ANIMATION_DELAY = 320; // ms — должно быть >= чем длительность exit spring в Sheet

interface ModalProps {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  disableSwipeClose?: boolean;
  /** Переопределить закрытие (редко — по умолчанию navigate('..')) */
  onClose?: () => void;
  /**
   * Как рендериться на десктопе.
   * - 'overlay' (default) — centered dialog поверх страницы
   * - 'page' — полноэкранная inline-страница (для /more/* разделов)
   */
  desktopStyle?: 'overlay' | 'page';
}

export function Modal({
  title,
  children,
  footer,
  disableSwipeClose,
  onClose,
  desktopStyle = 'overlay',
}: ModalProps) {
  const { closeModal } = useRouteModal();
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(true);

  const isDesktopPage = isDesktop && desktopStyle === 'page';

  const handleClose = useCallback(() => {
    if (isDesktopPage) {
      // На desktop-page нет exit-анимации sheet'а — сразу navigate
      if (onClose) {
        onClose();
      } else {
        closeModal();
      }
      return;
    }
    // Mobile или desktop overlay: играем exit-анимацию → потом navigate
    setOpen(false);
    window.setTimeout(() => {
      if (onClose) {
        onClose();
      } else {
        closeModal();
      }
    }, EXIT_ANIMATION_DELAY);
  }, [isDesktopPage, onClose, closeModal]);

  // === Desktop full-page ветка ===
  if (isDesktopPage) {
    return (
      <div className="ds-page">
        {title && (
          <div className="ds-page-header">
            <button
              type="button"
              className="ds-page-back"
              onClick={() => {
                haptic('light');
                handleClose();
              }}
            >
              <IconArrowLeft size={16} /> Назад
            </button>
            <h1 className="ds-page-title">{title}</h1>
          </div>
        )}
        <div className="ds-page-body">{children}</div>
        {footer && <div className="ds-page-footer">{footer}</div>}
      </div>
    );
  }

  // === Mobile sheet / Desktop centered dialog ===
  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title={title}
      footer={footer}
      disableSwipeClose={disableSwipeClose ?? false}
    >
      {children}
    </Sheet>
  );
}
