// Tipos del rotulado de invitaciones (ver supabase/migrations/004_labeling_jobs.sql)

export type LabelingStatus = 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'failed';

export type MappingSource = 'column' | 'typeform' | 'literal' | 'empty';

export interface PlaceholderMapping {
  source: MappingSource;
  column?: string;
  value?: string;
}

export interface RowError {
  row: number;
  name: string;
  message: string;
  retryable: boolean;
}

export interface LabelingJob {
  id: string;
  quotation_id: string | null;
  name: string;

  event_folder_id: string | null;
  event_folder_url: string | null;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  sheet_title: string | null;
  header_row: number;
  output_folder_id: string | null;
  output_folder_url: string | null;
  output_folder_name: string | null;
  template_id: string | null;
  template_url: string | null;
  typeform_url: string | null;

  placeholder_map: Record<string, PlaceholderMapping>;
  file_name_template: string;
  name_column: string | null;
  pdf_url_column: string;

  status: LabelingStatus;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  last_error: string | null;
  row_errors: RowError[];

  tmp_folder_id: string | null;
  keep_slide_copies: boolean;
  concurrency: number;

  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface SheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
}

export interface InspectResult {
  ok: true;
  service_account_email: string;
  event_folder: { id: string; name: string; url: string };
  output_folder_name: string;
  spreadsheet: {
    id: string;
    title: string;
    tabs: SheetTab[];
    selected_tab: string;
    headers: string[];
    sample_rows: string[][];
    data_row_count: number;
  };
  template: { id: string; title: string; placeholders: string[]; slide_count: number };
  suggested_map: Record<string, PlaceholderMapping>;
  warnings: string[];
}

export interface FunctionError {
  ok: false;
  code: string;
  message: string;
  step?: string;
  service_account_email?: string;
  /** Presente cuando el nombre de carpeta ya está tomado */
  existing_folder_url?: string;
}

export interface DryRunResult {
  ok: true;
  dry_run: true;
  total: number;
  done: number;
  remaining: number;
  preview: { row: number; file_name: string; values: Record<string, string> }[];
}

/** Los estados propios se pintan con los badges que ya existen en index.css */
export const STATUS_BADGE: Record<LabelingStatus, string> = {
  draft: 'badge-pendiente',
  ready: 'badge-pendiente',
  running: 'badge-enviada',
  paused: 'badge-cotizado',
  completed: 'badge-aceptada',
  failed: 'badge-rechazada',
};

export const STATUS_LABEL: Record<LabelingStatus, string> = {
  draft: 'Borrador',
  ready: 'Listo',
  running: 'Generando',
  paused: 'Pausado',
  completed: 'Completado',
  failed: 'Con error',
};
