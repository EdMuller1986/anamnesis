import {
  IconPhoto,
  IconFileTypePdf,
  IconFile,
  IconExternalLink,
  IconDownload,
  IconFileText,
  IconBrain,
  IconTag,
  IconUser,
  IconBuildingHospital,
} from '@tabler/icons-react';
import { Button, ExpandableText, ZoomableImage, CopyButton } from '@/shared/ui';
import { docFileUrl, isImage, isPdf, DOC_CATEGORY_LABELS } from '../lib/doc-helpers';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { PdfRenderer } from './PdfRenderer';
import type { Document } from '@/shared/types';

/**
 * Блок одного документа внутри деталей визита.
 * Порт из vanilla `documents.js:226-285` (renderDocumentBlock).
 */
export function DocumentBlock({ doc }: { doc: Document }) {
  const url = docFileUrl(doc);
  const img = isImage(doc);
  const pdf = isPdf(doc);

  return (
    <div
      style={{
        background: 'var(--bg)',
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text)',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {img ? (
          <IconPhoto size={16} color="var(--blue)" />
        ) : pdf ? (
          <IconFileTypePdf size={16} color="var(--red)" />
        ) : (
          <IconFile size={16} color="var(--text-secondary)" />
        )}
        {doc.title ?? doc.original_name ?? 'Документ'}
      </div>

      {url && img && (
        <div
          style={{
            textAlign: 'center',
            maxHeight: '50vh',
            overflow: 'auto',
            borderRadius: 10,
            border: '1px solid var(--border)',
            marginBottom: 10,
          }}
        >
          <ZoomableImage src={url} alt={doc.title ?? ''} />
        </div>
      )}

      {/* PDF — рендерим страницы на клиенте через pdf.js. 
          Это заменяет старую логику pdftoppm на бэкенде. */}
      {url && pdf && (
        <PdfRenderer url={url} title={doc.title ?? doc.original_name} />
      )}

      {url && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {/* Открываем через window.open а не <a target="_blank">, потому
              что в PWA standalone <a target="_blank"> часто открывается в
              том же окне → React Router ловит /uploads/xxx.pdf → catch-all
              → /dashboard. window.open пробивает в системный браузер. */}
          <Button
            size="sm"
            block
            icon={<IconExternalLink size={13} />}
            onClick={(e) => {
              e.stopPropagation();
              window.open(url, '_blank', 'noopener,noreferrer');
            }}
          >
            Открыть
          </Button>
          {/* Для скачивания используем временный якорь — download работает
              через прямую ссылку. Тоже не должен навигировать в PWA. */}
          <Button
            size="sm"
            variant="secondary"
            block
            icon={<IconDownload size={13} />}
            onClick={(e) => {
              e.stopPropagation();
              const a = document.createElement('a');
              a.href = url;
              a.download = doc.original_name ?? doc.title ?? 'document';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
          >
            Скачать
          </Button>
        </div>
      )}

      {doc.transcription && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 4,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <IconFileText size={13} /> Расшифровка
            </span>
            <CopyButton text={doc.transcription} />
          </div>
          <div
            style={{
              background: 'var(--card)',
              borderRadius: 10,
              padding: 12,
            }}
          >
            <ExpandableText
              text={doc.transcription}
              bg="var(--card)"
              textStyle={{ fontSize: 12, lineHeight: 1.7 }}
              actionColor="var(--text)"
            />
          </div>
        </div>
      )}

      {doc.ai_assessment && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--purple)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <IconBrain size={13} /> Оценка AI
          </div>
          <div
            style={{
              background: '#F8F1FC',
              border: '1px solid rgba(175,82,222,0.15)',
              borderRadius: 10,
              padding: 12,
            }}
          >
            <ExpandableText
              text={doc.ai_assessment}
              bg="#F8F1FC"
              textStyle={{ fontSize: 12, lineHeight: 1.7 }}
              actionColor="var(--purple)"
            />
          </div>
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
      >
        {doc.category && (
          <span>
            <IconTag size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
            {DOC_CATEGORY_LABELS[doc.category] ?? doc.category}
          </span>
        )}
        {doc.source_doctor && (
          <span>
            <IconUser size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
            {doc.source_doctor}
          </span>
        )}
        {doc.source_org && (
          <span>
            <IconBuildingHospital size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
            {doc.source_org}
          </span>
        )}
      </div>

      {/* Комментарии к конкретному документу внутри визита.
          Раньше отсутствовали — если у документа были пользовательские
          комменты и ответы AI (entity_type='document'), они не показывались
          и выглядели как "потерянные". */}
      <CommentsSection entityType="document" entityId={doc.id} />
    </div>
  );
}
