import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import { IconCloudUpload, IconX } from '@tabler/icons-react';
import { Modal, Input, Select, Textarea, Button } from '@/shared/ui';
import { useRouteModal } from '@/shared/hooks/useRouteModal';
import { useTimeline } from '../hooks/useTimeline';
import { useUploadDocument } from '../hooks/useVisitMutations';
import { formatDate } from '@/shared/lib/date';
import { haptic } from '@/shared/lib/haptic';

/**
 * Модалка загрузки документа. Route: `/documents/upload`
 *
 * Порт из vanilla `documents.js` showUploadModal:
 * - drag-and-drop зона
 * - выбор файла кликом
 * - форма с названием, привязкой к визиту, категорией, описанием
 * - multipart upload через /api/documents
 */
export default function UploadDocumentModal() {
  const { closeModal } = useRouteModal();
  const { data: timeline } = useTimeline();
  const upload = useUploadDocument();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [timelineId, setTimelineId] = useState('');
  const [category, setCategory] = useState('lab');
  const [notes, setNotes] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectFile = (f: File) => {
    setFile(f);
    haptic('light');
    if (!title) {
      // Убираем расширение из имени файла
      setTitle(f.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) selectFile(f);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) selectFile(f);
  };

  const handleSubmit = async () => {
    if (!file) return;
    await upload.mutateAsync({
      file,
      title: title.trim() || file.name,
      category,
      notes: notes.trim() || "",
      timeline_id: timelineId ? Number(timelineId) : null,
    });
    closeModal();
  };

  return (
    <Modal title="Загрузка документа">
      {/* Drop area */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
          borderRadius: 12,
          padding: '24px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'rgba(0,122,255,0.04)' : 'var(--bg)',
          transition: 'all 0.15s ease',
        }}
      >
        <IconCloudUpload
          size={36}
          color="var(--blue)"
          style={{ display: 'block', margin: '0 auto 8px' }}
        />
        <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
          Нажмите или перетащите файл
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          PDF, JPG, PNG до 50 МБ
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.docx"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {file && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(52,199,89,0.1)',
            border: '1px solid rgba(52,199,89,0.2)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--green)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name}
          </span>
          <button
            type="button"
            onClick={() => setFile(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
            aria-label="Убрать файл"
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      <div className="form-group" style={{ marginTop: 16 }}>
        <label className="form-label">Название</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название документа"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Привязать к приёму</label>
        <Select value={timelineId} onChange={(e) => setTimelineId(e.target.value)}>
          <option value="">— Без привязки (отдельный документ) —</option>
          {(timeline ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({formatDate(t.event_date)})
            </option>
          ))}
        </Select>
      </div>

      <div className="form-group">
        <label className="form-label">Категория</label>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="lab">Анализы</option>
          <option value="imaging">Снимки</option>
          <option value="prescription">Рецепт</option>
          <option value="report">Заключение</option>
          <option value="other">Другое</option>
        </Select>
      </div>

      <div className="form-group">
        <label className="form-label">Описание</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Описание (необязательно)"
          rows={2}
        />
      </div>

      <Button
        block
        onClick={() => void handleSubmit()}
        loading={upload.isPending}
        disabled={!file}
        style={{ marginTop: 8 }}
      >
        Загрузить документ
      </Button>
    </Modal>
  );
}
