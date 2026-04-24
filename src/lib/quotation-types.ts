// ─── Product Types ───────────────────────────────────────────
export type ProductType =
  | 'invitacion_digital'
  | 'save_the_date'
  | 'envio_invitaciones'
  | 'confirmaciones';

export type InvitationFormat = 'pdf_interactivo' | 'pagina_web';

export type EventType = 'boda' | 'boda_civil' | 'evento_social' | 'otros';

export type ReferralSource =
  | 'redes_sociales'
  | 'wedding_planner'
  | 'invitacion_we'
  | 'recomendacion'
  | 'otra';

export type ClientStatus =
  | 'nuevo'
  | 'cotizado'
  | 'anticipo'
  | 'en_proceso'
  | 'finalizado'
  | 'cancelado';

export type QuotationStatus = 'pendiente' | 'enviada' | 'aceptada' | 'rechazada';
export type PaymentType = 'anticipo' | 'pago' | 'finiquito' | 'extra';
export type PaymentStatus = 'pendiente' | 'pagado' | 'cancelado';

// ─── Guest Count Ranges ──────────────────────────────────────
export const GUEST_COUNT_RANGES = [
  { label: '1–50', min: 1, max: 50 },
  { label: '50–100', min: 50, max: 100 },
  { label: '100–150', min: 100, max: 150 },
  { label: '150–200', min: 150, max: 200 },
  { label: '200–250', min: 200, max: 250 },
  { label: '250–300', min: 250, max: 300 },
  { label: '300–350', min: 300, max: 350 },
  { label: '350+', min: 350, max: 350 },
] as const;

export type GuestCountRange = (typeof GUEST_COUNT_RANGES)[number]['label'];

// ─── Sub-event Types ─────────────────────────────────────────
export type SubEvent = 'civil' | 'welcome' | 'tornaboda' | 'otro';

// ─── Monogram Choice ─────────────────────────────────────────
export type MonogramChoice = 'yes' | 'no' | 'already_have';

// ─── Design Style ────────────────────────────────────────────
export type DesignStyle = 'photos' | 'graphic' | 'mixed' | 'unsure';

// ─── Gift Table Choice ───────────────────────────────────────
export type GiftTableChoice = 'link_tienda' | 'transferencia' | 'mesa_experiencias' | 'not_sure';

// ─── Experience Tier ─────────────────────────────────────────
export type ExperienceTier = 'essential_10' | 'intermediate_20' | 'complete_30' | 'full_30plus';

// ─── Info Categories ─────────────────────────────────────────
export type InfoCategory =
  | 'hospedaje'
  | 'restaurantes'
  | 'transporte'
  | 'lugares'
  | 'belleza'
  | 'otro';

// ─── Info Options Count ──────────────────────────────────────
export type InfoOptionsCount = '1_3' | '4_6' | '6_plus';

// ─── Web Extras ──────────────────────────────────────────────
export type WebExtra = 'bilingue' | 'password' | 'clima';

// ─── Additional Products ─────────────────────────────────────
export type AdditionalProduct =
  | 'save_the_date'
  | 'pdf_adicional'
  | 'pagina_web_adicional'
  | 'our_moments'
  | 'layout_mesas'
  | 'none';

// ─── Save the Date Format ────────────────────────────────────
export type StdFormat = 'basico' | 'extendido';

// ─── Form Data (all form responses) ─────────────────────────
export interface QuotationFormData {
  // General
  contactName: string;
  contactPhone: string;
  referralSource: ReferralSource | null;
  weddingPlannerName: string;
  eventType: EventType | null;
  eventDate: string; // ISO date string
  productType: ProductType | null;
  lang: 'es' | 'en';

  // Invitation Digital
  invitationFormat: InvitationFormat | null;

  // PDF Interactivo
  pdfMultipleEvents: boolean | null;
  pdfSubEvents: SubEvent[];
  pdfSameGuests: boolean | null;
  pdfMonogram: MonogramChoice | null;
  pdfIllustrations: boolean | null;
  pdfGiftTable: GiftTableChoice[];
  pdfExperienceTier: ExperienceTier | null;
  pdfAdditionalInfo: boolean | null;
  pdfInfoCategories: InfoCategory[];
  pdfInfoOptionsCount: InfoOptionsCount | null;
  pdfPersonalized: boolean | null;
  pdfRsvp: boolean | null;
  pdfSending: boolean | null;
  pdfConfirmation: boolean | null;
  pdfGuestCountRange: GuestCountRange | null;
  pdfAdditionalProducts: AdditionalProduct[];

  // Página Web
  webEventCount: number | null; // 1, 2, 3, 4
  webSeparatePages: boolean | null;
  webDomainType: 'generic' | 'custom' | null;
  webMonogram: MonogramChoice | null;
  webDesignStyle: DesignStyle | null;
  webIllustrations: boolean | null;
  webGiftTable: GiftTableChoice[];
  webExperienceTier: ExperienceTier | null;
  webAdditionalInfo: boolean | null;
  webInfoCategories: InfoCategory[];
  webInfoOptionsCount: InfoOptionsCount | null;
  webRsvp: boolean | null;
  webExtras: WebExtra[];
  webSending: boolean | null;
  webConfirmation: boolean | null;
  webGuestCountRange: GuestCountRange | null;
  webAdditionalProducts: AdditionalProduct[];

  // Save the Date
  stdFormat: StdFormat | null;
  stdDesignStyle: DesignStyle | null;
  stdSending: boolean | null;
  stdGuestCountRange: GuestCountRange | null;

  // Envío / Confirmaciones
  sendGuestCountRange: GuestCountRange | null;
  confirmGuestCountRange: GuestCountRange | null;
}

// ─── Price Breakdown ─────────────────────────────────────────
export interface PriceItem {
  key: string;
  label: { es: string; en: string };
  amount: number;
}

export interface PerGuestItem {
  key: string;
  label: { es: string; en: string };
  pricePerGuest: number;
  guestRange: GuestCountRange;
  estimatedGuests: number; // Highest in range
  estimatedTotal: number;
}

export interface PriceBreakdown {
  basePrice: number;
  baseLabel: { es: string; en: string };
  items: PriceItem[];
  perGuestItems: PerGuestItem[];
  subtotal: number;
  perGuestTotal: number;
  estimatedTotal: number;
  notes: { es: string; en: string }[];
}

// ─── Initial Form State ──────────────────────────────────────
export const INITIAL_FORM_DATA: QuotationFormData = {
  contactName: '',
  contactPhone: '',
  referralSource: null,
  weddingPlannerName: '',
  eventType: null,
  eventDate: '',
  productType: null,
  lang: 'es',

  invitationFormat: null,

  pdfMultipleEvents: null,
  pdfSubEvents: [],
  pdfSameGuests: null,
  pdfMonogram: null,
  pdfIllustrations: null,
  pdfGiftTable: [],
  pdfExperienceTier: null,
  pdfAdditionalInfo: null,
  pdfInfoCategories: [],
  pdfInfoOptionsCount: null,
  pdfPersonalized: null,
  pdfRsvp: null,
  pdfSending: null,
  pdfConfirmation: null,
  pdfGuestCountRange: null,
  pdfAdditionalProducts: [],

  webEventCount: null,
  webSeparatePages: null,
  webDomainType: null,
  webMonogram: null,
  webDesignStyle: null,
  webIllustrations: null,
  webGiftTable: [],
  webExperienceTier: null,
  webAdditionalInfo: null,
  webInfoCategories: [],
  webInfoOptionsCount: null,
  webRsvp: null,
  webExtras: [],
  webSending: null,
  webConfirmation: null,
  webGuestCountRange: null,
  webAdditionalProducts: [],

  stdFormat: null,
  stdDesignStyle: null,
  stdSending: null,
  stdGuestCountRange: null,

  sendGuestCountRange: null,
  confirmGuestCountRange: null,
};

// ─── DB Types ────────────────────────────────────────────────
export interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  referral_source: string;
  wedding_planner?: string;
  event_type: string;
  event_date?: string;
  status: ClientStatus;
  notes?: string;
  lang: string;
  created_at: string;
  updated_at: string;
}

export type DocumentStatus = 'pending' | 'generating' | 'completed' | 'failed';

export interface Quotation {
  id: string;
  client_id: string;
  product_type: string;
  base_price: number;
  extras_price: number;
  total_price: number;
  responses: QuotationFormData;
  price_breakdown: PriceBreakdown;
  guest_count_range?: string;
  drive_document_url?: string;
  document_pdf_url?: string;
  document_type?: string;
  document_status?: DocumentStatus;
  document_error?: string;
  status: QuotationStatus;
  created_at: string;
  // Joined
  client?: Client;
  payments?: Payment[];
}

export interface Payment {
  id: string;
  quotation_id: string;
  type: PaymentType;
  amount: number;
  description?: string;
  payment_date: string;
  status: PaymentStatus;
  receipt_url?: string;
  created_at: string;
}

export interface Document {
  id: string;
  quotation_id: string;
  template_name: string;
  drive_url?: string;
  drive_file_id?: string;
  created_at: string;
}
