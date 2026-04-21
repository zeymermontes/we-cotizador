import {
  type QuotationFormData,
  type PriceBreakdown,
  type PriceItem,
  type PerGuestItem,
  GUEST_COUNT_RANGES,
  type GuestCountRange,
} from './quotation-types';

// ─── Helper: get max guests from range ──────────────────────
function getMaxGuests(range: GuestCountRange | null): number {
  if (!range) return 0;
  const found = GUEST_COUNT_RANGES.find(r => r.label === range);
  return found ? found.max : 0;
}

// ─── Main Pricing Function ──────────────────────────────────
export function calculatePrice(data: QuotationFormData): PriceBreakdown {
  const items: PriceItem[] = [];
  const perGuestItems: PerGuestItem[] = [];
  const notes: { es: string; en: string }[] = [];
  let basePrice = 0;
  let baseLabel = { es: '', en: '' };

  // ─── BRANCH: PDF Interactivo ────────────────────────────
  if (data.productType === 'invitacion_digital' && data.invitationFormat === 'pdf_interactivo') {
    basePrice = 5800;
    baseLabel = { es: 'PDF Interactivo', en: 'Interactive PDF' };

    // Sub-events ($300 each)
    if (data.pdfMultipleEvents === true) {
      for (const sub of data.pdfSubEvents) {
        const labelMap: Record<string, { es: string; en: string }> = {
          civil: { es: 'Evento: Civil', en: 'Event: Civil' },
          welcome: { es: 'Evento: Welcome/Rompehielos', en: 'Event: Welcome/Icebreaker' },
          tornaboda: { es: 'Evento: Tornaboda', en: 'Event: After-party' },
          otro: { es: 'Evento: Otro', en: 'Event: Other' },
        };
        items.push({ key: `pdf_sub_${sub}`, label: labelMap[sub] || { es: sub, en: sub }, amount: 300 });
      }

      // Different guest groups
      if (data.pdfSameGuests === false) {
        items.push({
          key: 'pdf_different_guests',
          label: { es: 'Grupos distintos de invitados', en: 'Different guest groups' },
          amount: 1200,
        });
      }
    }

    // Monogram
    if (data.pdfMonogram === 'yes') {
      items.push({ key: 'pdf_monogram', label: { es: 'Monograma', en: 'Monogram' }, amount: 500 });
    }

    // Illustrations
    if (data.pdfIllustrations === true) {
      items.push({
        key: 'pdf_illustrations',
        label: { es: 'Ilustraciones personalizadas', en: 'Custom illustrations' },
        amount: 500,
      });
    }

    // Experience table
    if (data.pdfGiftTable === 'mesa_experiencias' && data.pdfExperienceTier) {
      const tierPrices: Record<string, number> = {
        essential_10: 2000,
        intermediate_20: 2500,
        complete_30: 3000,
        full_30plus: 3500,
      };
      const tierLabels: Record<string, { es: string; en: string }> = {
        essential_10: { es: 'Mesa experiencias: Esencial (10)', en: 'Experience table: Essential (10)' },
        intermediate_20: { es: 'Mesa experiencias: Intermedia (20)', en: 'Experience table: Intermediate (20)' },
        complete_30: { es: 'Mesa experiencias: Completa (30)', en: 'Experience table: Complete (30)' },
        full_30plus: { es: 'Mesa experiencias: Muy completa (30+)', en: 'Experience table: Full (30+)' },
      };
      items.push({
        key: 'pdf_experiences',
        label: tierLabels[data.pdfExperienceTier],
        amount: tierPrices[data.pdfExperienceTier],
      });
    }

    // Additional info - categories
    if (data.pdfAdditionalInfo === true && data.pdfInfoCategories.length > 0) {
      const catCount = data.pdfInfoCategories.length;
      const catPrices: Record<number, number> = { 1: 300, 2: 400, 3: 500, 4: 600, 5: 700 };
      const price = catPrices[Math.min(catCount, 5)] || 700;
      items.push({
        key: 'pdf_info_categories',
        label: {
          es: `Información adicional (${catCount} categoría${catCount > 1 ? 's' : ''})`,
          en: `Additional info (${catCount} categor${catCount > 1 ? 'ies' : 'y'})`,
        },
        amount: price,
      });

      // Options count
      if (data.pdfInfoOptionsCount) {
        const optPrices: Record<string, number> = { '1_3': 0, '4_6': 300, '6_plus': 600 };
        const optLabels: Record<string, { es: string; en: string }> = {
          '1_3': { es: '1-3 opciones mencionadas', en: '1-3 mentioned options' },
          '4_6': { es: '4-6 opciones mencionadas', en: '4-6 mentioned options' },
          '6_plus': { es: 'Más de 6 opciones', en: 'More than 6 options' },
        };
        const optPrice = optPrices[data.pdfInfoOptionsCount];
        if (optPrice > 0) {
          items.push({
            key: 'pdf_info_options',
            label: optLabels[data.pdfInfoOptionsCount],
            amount: optPrice,
          });
        }
      }
    }

    // Sending ($18/guest)
    if (data.pdfSending === true && data.pdfGuestCountRange) {
      const maxGuests = getMaxGuests(data.pdfGuestCountRange);
      perGuestItems.push({
        key: 'pdf_sending',
        label: { es: 'Envío de invitaciones', en: 'Invitation sending' },
        pricePerGuest: 18,
        guestRange: data.pdfGuestCountRange,
        estimatedGuests: maxGuests,
        estimatedTotal: 18 * maxGuests,
      });
    }

    // Confirmation ($22/guest)
    if (data.pdfConfirmation === true && data.pdfGuestCountRange) {
      const maxGuests = getMaxGuests(data.pdfGuestCountRange);
      perGuestItems.push({
        key: 'pdf_confirmation',
        label: { es: 'Confirmación de asistencia', en: 'Attendance confirmation' },
        pricePerGuest: 22,
        guestRange: data.pdfGuestCountRange,
        estimatedGuests: maxGuests,
        estimatedTotal: 22 * maxGuests,
      });
    }

    // Additional products
    for (const prod of data.pdfAdditionalProducts) {
      if (prod === 'save_the_date') {
        items.push({ key: 'pdf_extra_std', label: { es: 'Save the Date', en: 'Save the Date' }, amount: 2500 });
      } else if (prod === 'pdf_adicional') {
        items.push({
          key: 'pdf_extra_pdf',
          label: { es: 'PDF Interactivo adicional', en: 'Additional Interactive PDF' },
          amount: 1500,
        });
      } else if (prod === 'pagina_web_adicional') {
        notes.push({
          es: 'Página Web adicional: precio depende de la cotización de página web',
          en: 'Additional web page: price depends on web page quote',
        });
      }
    }
  }

  // ─── BRANCH: Página Web ─────────────────────────────────
  if (data.productType === 'invitacion_digital' && data.invitationFormat === 'pagina_web') {
    basePrice = 9000;
    baseLabel = { es: 'Página Web', en: 'Web Page' };

    // Events count
    if (data.webEventCount && data.webEventCount > 1) {
      const evtPrices: Record<number, number> = { 2: 1000, 3: 2000, 4: 3000 };
      const price = evtPrices[Math.min(data.webEventCount, 4)] || 3000;
      items.push({
        key: 'web_events',
        label: {
          es: `${data.webEventCount} eventos`,
          en: `${data.webEventCount} events`,
        },
        amount: price,
      });

      // Separate pages
      if (data.webSeparatePages === true) {
        items.push({
          key: 'web_separate_pages',
          label: { es: 'Páginas separadas por evento', en: 'Separate pages per event' },
          amount: 1000,
        });
      }
    }

    // Custom domain
    if (data.webDomainType === 'custom') {
      items.push({
        key: 'web_custom_domain',
        label: { es: 'Dominio personalizado', en: 'Custom domain' },
        amount: 400,
      });
    }

    // Monogram
    if (data.webMonogram === 'yes') {
      items.push({ key: 'web_monogram', label: { es: 'Monograma', en: 'Monogram' }, amount: 500 });
    }

    // Design style
    if (data.webDesignStyle === 'graphic' || data.webDesignStyle === 'mixed') {
      items.push({
        key: 'web_design',
        label: {
          es: data.webDesignStyle === 'graphic' ? 'Diseño gráfico (sin fotos)' : 'Diseño mixto',
          en: data.webDesignStyle === 'graphic' ? 'Graphic design (no photos)' : 'Mixed design',
        },
        amount: 300,
      });
    }

    // Illustrations
    if (data.webIllustrations === true) {
      items.push({
        key: 'web_illustrations',
        label: { es: 'Ilustraciones personalizadas', en: 'Custom illustrations' },
        amount: 800,
      });
    }

    // Experience table
    if (data.webGiftTable === 'mesa_experiencias' && data.webExperienceTier) {
      const tierPrices: Record<string, number> = {
        essential_10: 2000,
        intermediate_20: 2500,
        complete_30: 3000,
        full_30plus: 3500,
      };
      const tierLabels: Record<string, { es: string; en: string }> = {
        essential_10: { es: 'Mesa experiencias: Esencial (10)', en: 'Experience table: Essential (10)' },
        intermediate_20: { es: 'Mesa experiencias: Intermedia (20)', en: 'Experience table: Intermediate (20)' },
        complete_30: { es: 'Mesa experiencias: Completa (30)', en: 'Experience table: Complete (30)' },
        full_30plus: { es: 'Mesa experiencias: Muy completa (30+)', en: 'Experience table: Full (30+)' },
      };
      items.push({
        key: 'web_experiences',
        label: tierLabels[data.webExperienceTier],
        amount: tierPrices[data.webExperienceTier],
      });
    }

    // Additional info - categories (Web pricing is different: 500-900)
    if (data.webAdditionalInfo === true && data.webInfoCategories.length > 0) {
      const catCount = data.webInfoCategories.length;
      const catPrices: Record<number, number> = { 1: 500, 2: 600, 3: 700, 4: 800, 5: 900 };
      const price = catPrices[Math.min(catCount, 5)] || 900;
      items.push({
        key: 'web_info_categories',
        label: {
          es: `Información adicional (${catCount} categoría${catCount > 1 ? 's' : ''})`,
          en: `Additional info (${catCount} categor${catCount > 1 ? 'ies' : 'y'})`,
        },
        amount: price,
      });

      // Options count (Web: 0, 500, 800)
      if (data.webInfoOptionsCount) {
        const optPrices: Record<string, number> = { '1_3': 0, '4_6': 500, '6_plus': 800 };
        const optLabels: Record<string, { es: string; en: string }> = {
          '1_3': { es: '1-3 opciones', en: '1-3 options' },
          '4_6': { es: '4-6 opciones', en: '4-6 options' },
          '6_plus': { es: 'Más de 6 opciones', en: 'More than 6 options' },
        };
        const optPrice = optPrices[data.webInfoOptionsCount];
        if (optPrice > 0) {
          items.push({
            key: 'web_info_options',
            label: optLabels[data.webInfoOptionsCount],
            amount: optPrice,
          });
        }
      }
    }

    // Web extras
    for (const extra of data.webExtras) {
      if (extra === 'bilingue') {
        items.push({
          key: 'web_bilingue',
          label: { es: 'Página bilingüe', en: 'Bilingual page' },
          amount: 1500,
        });
      } else if (extra === 'password') {
        items.push({
          key: 'web_password',
          label: { es: 'Página con contraseña', en: 'Password-protected page' },
          amount: 700,
        });
      } else if (extra === 'clima') {
        items.push({
          key: 'web_weather',
          label: { es: 'Clima en tiempo real', en: 'Real-time weather' },
          amount: 300,
        });
      }
    }

    // Sending ($18/guest)
    if (data.webSending === true && data.webGuestCountRange) {
      const maxGuests = getMaxGuests(data.webGuestCountRange);
      perGuestItems.push({
        key: 'web_sending',
        label: { es: 'Envío de invitaciones', en: 'Invitation sending' },
        pricePerGuest: 18,
        guestRange: data.webGuestCountRange,
        estimatedGuests: maxGuests,
        estimatedTotal: 18 * maxGuests,
      });
    }

    // Confirmation ($22/guest)
    if (data.webConfirmation === true && data.webGuestCountRange) {
      const maxGuests = getMaxGuests(data.webGuestCountRange);
      perGuestItems.push({
        key: 'web_confirmation',
        label: { es: 'Confirmación de asistencia', en: 'Attendance confirmation' },
        pricePerGuest: 22,
        guestRange: data.webGuestCountRange,
        estimatedGuests: maxGuests,
        estimatedTotal: 22 * maxGuests,
      });
    }

    // Additional products
    for (const prod of data.webAdditionalProducts) {
      if (prod === 'save_the_date') {
        items.push({ key: 'web_extra_std', label: { es: 'Save the Date', en: 'Save the Date' }, amount: 2500 });
      } else if (prod === 'pdf_adicional') {
        items.push({
          key: 'web_extra_pdf',
          label: { es: 'PDF Interactivo adicional', en: 'Additional Interactive PDF' },
          amount: 1500,
        });
      }
    }
  }

  // ─── BRANCH: Save the Date ──────────────────────────────
  if (data.productType === 'save_the_date') {
    if (data.stdFormat === 'basico') {
      basePrice = 2500;
      baseLabel = { es: 'Save the Date - Básico', en: 'Save the Date - Basic' };
    } else if (data.stdFormat === 'extendido') {
      basePrice = 3300;
      baseLabel = { es: 'Save the Date - Extendido', en: 'Save the Date - Extended' };
    }

    // Sending ($15/guest)
    if (data.stdSending === true && data.stdGuestCountRange) {
      const maxGuests = getMaxGuests(data.stdGuestCountRange);
      perGuestItems.push({
        key: 'std_sending',
        label: { es: 'Envío de Save the Date', en: 'Save the Date sending' },
        pricePerGuest: 15,
        guestRange: data.stdGuestCountRange,
        estimatedGuests: maxGuests,
        estimatedTotal: 15 * maxGuests,
      });
    }
  }

  // ─── BRANCH: Envío only ─────────────────────────────────
  if (data.productType === 'envio_invitaciones') {
    basePrice = 0;
    baseLabel = { es: 'Envío de invitaciones', en: 'Invitation sending' };

    if (data.sendGuestCountRange) {
      const maxGuests = getMaxGuests(data.sendGuestCountRange);
      perGuestItems.push({
        key: 'send_only',
        label: { es: 'Envío de invitaciones', en: 'Invitation sending' },
        pricePerGuest: 18,
        guestRange: data.sendGuestCountRange,
        estimatedGuests: maxGuests,
        estimatedTotal: 18 * maxGuests,
      });
    }
  }

  // ─── BRANCH: Confirmaciones only ────────────────────────
  if (data.productType === 'confirmaciones') {
    basePrice = 0;
    baseLabel = { es: 'Confirmación de asistencia', en: 'Attendance confirmation' };

    if (data.confirmGuestCountRange) {
      const maxGuests = getMaxGuests(data.confirmGuestCountRange);
      perGuestItems.push({
        key: 'confirm_only',
        label: { es: 'Confirmación de asistencia', en: 'Attendance confirmation' },
        pricePerGuest: 22,
        guestRange: data.confirmGuestCountRange,
        estimatedGuests: maxGuests,
        estimatedTotal: 22 * maxGuests,
      });
    }
  }

  // ─── Calculate totals ───────────────────────────────────
  const subtotal = basePrice + items.reduce((sum, i) => sum + i.amount, 0);
  const perGuestTotal = perGuestItems.reduce((sum, i) => sum + i.estimatedTotal, 0);
  const estimatedTotal = subtotal + perGuestTotal;

  return {
    basePrice,
    baseLabel,
    items,
    perGuestItems,
    subtotal,
    perGuestTotal,
    estimatedTotal,
    notes,
  };
}
