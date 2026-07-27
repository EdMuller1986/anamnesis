import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { ZoomableImage, Spinner } from '@/shared/ui';

// Настройка воркера для Vite
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PdfRendererProps {
  url: string;
  title?: string | null;
}

/**
 * Компонент для рендеринга PDF на клиенте.
 * Скачивает PDF, парсит его через pdf.js и отрисовывает каждую страницу
 * в виде base64-картинки для использования в ZoomableImage.
 */
export function PdfRenderer({ url, title }: PdfRendererProps) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let isMounted = true;
    abortControllerRef.current = new AbortController();

    async function loadPdf() {
      setLoading(true);
      setError(null);
      try {
        const loadingTask = pdfjs.getDocument({
          url,
          // Передаем куки и заголовки если нужно, но так как у нас токен в URL, это не требуется
          withCredentials: true, 
        });

        const pdf = await loadingTask.promise;
        const pageImages: string[] = [];

        // Рендерим первые N страниц (например, 10), чтобы не перегружать память
        const maxPages = Math.min(pdf.numPages, 20);

        for (let i = 1; i <= maxPages; i++) {
          if (!isMounted) break;
          
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 }); // Высокое качество для зума
          
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            await page.render({ canvasContext: context, viewport }).promise;
            pageImages.push(canvas.toDataURL('image/png'));
          }
        }

        if (isMounted) {
          setPages(pageImages);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('PDF Render Error:', err);
        if (isMounted) {
          setError('Не удалось загрузить предпросмотр PDF. Попробуйте открыть файл напрямую.');
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isMounted = false;
      abortControllerRef.current?.abort();
    };
  }, [url]);

  if (loading) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center' }}>
        <Spinner />
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
          Генерация превью...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        padding: 12, 
        fontSize: 12, 
        color: 'var(--red)', 
        background: 'rgba(255,0,0,0.05)',
        borderRadius: 8,
        textAlign: 'center' 
      }}>
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        maxHeight: '60vh',
        overflow: 'auto',
        borderRadius: 10,
        border: '1px solid var(--border)',
        marginBottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 8,
        background: 'rgba(0,0,0,0.02)',
      }}
    >
      {pages.map((src, idx) => (
        <div key={idx} style={{ textAlign: 'center' }}>
          <ZoomableImage
            src={src}
            alt={`${title ?? 'PDF'} — стр. ${idx + 1}`}
            style={{ maxWidth: '100%', display: 'block', margin: '0 auto', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
          />
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-secondary)',
              marginTop: 6,
            }}
          >
            стр. {idx + 1} из {pages.length}
          </div>
        </div>
      ))}
    </div>
  );
}
