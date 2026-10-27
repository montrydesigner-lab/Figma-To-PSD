export const MAX_FILE_BYTES = 1_500_000_000;
export type JobStatus = 'queued' | 'ready' | 'reading' | 'fonts' | 'converting' | 'importing' | 'success' | 'failed' | 'cancelled';
export interface QueueJob {
  id: string;
  name: string;
  displayName: string;
  size: number;
  file?: File;
  status: JobStatus;
  progress: number;
  attempts: number;
  error?: string;
  retryable: boolean;
  report?: Record<string, unknown>;
}
/** Metadata only: never read or decode a queued File here. */
export function validateFile(file: Pick<File, 'name' | 'size'>): string | undefined {
  if (!/\.(psd|psb|zip)$/i.test(file.name)) return '格式不支持：请选择 PSD、PSB 或仅含一个源文件的 ZIP。';
  if (!Number.isFinite(file.size) || file.size <= 0) return '文件为空或大小无效。';
  if (file.size > MAX_FILE_BYTES) return '文件超过 1.5 GB（1,500,000,000 字节），请拆分后重新选择。';
  return undefined;
}
export function safeDocumentName(filename: string): string {
  return filename.replace(/\.(psd|psb|zip)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().slice(0, 160) || 'Photoshop 文件';
}
export function createJobs(files: readonly File[], id: () => string): QueueJob[] {
  const used = new Set<string>();
  return files.map(file => {
    const base = safeDocumentName(file.name);
    let displayName = base, ordinal = 1;
    while (used.has(displayName.toLocaleLowerCase())) displayName = `${base} (${++ordinal})`;
    used.add(displayName.toLocaleLowerCase());
    const error = validateFile(file);
    return { id: id(), name: file.name, displayName, size: file.size, file: error ? undefined : file,
      status: error ? 'failed' : 'queued', progress: 0, attempts: 0, retryable: !error, ...(error ? { error } : {}) };
  });
}
