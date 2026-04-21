import { useState, useCallback, useMemo } from 'react';
import {
  type QuotationFormData,
  type PriceBreakdown,
  INITIAL_FORM_DATA,
} from '../lib/quotation-types';
import { calculatePrice } from '../lib/pricing-engine';

export function useQuotation() {
  const [formData, setFormData] = useState<QuotationFormData>({ ...INITIAL_FORM_DATA });
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const updateField = useCallback(<K extends keyof QuotationFormData>(
    field: K,
    value: QuotationFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateFields = useCallback((fields: Partial<QuotationFormData>) => {
    setFormData(prev => ({ ...prev, ...fields }));
  }, []);

  const priceBreakdown: PriceBreakdown = useMemo(() => {
    return calculatePrice(formData);
  }, [formData]);

  // Determine the list of step keys based on current selections
  const stepKeys = useMemo(() => {
    const steps: string[] = [
      'contact',    // Step 1: Name + Phone
      'referral',   // Step 2: How found us
      'eventType',  // Step 3: Event type
      'eventDate',  // Step 4: Event date
      'product',    // Step 5: Product selection
    ];

    if (formData.productType === 'invitacion_digital') {
      steps.push('format'); // Step 6: PDF vs Web

      if (formData.invitationFormat === 'pdf_interactivo') {
        steps.push('pdf_events');
        if (formData.pdfMultipleEvents === true) {
          steps.push('pdf_sub_events');
          steps.push('pdf_guest_groups');
        }
        steps.push('pdf_monogram');
        steps.push('pdf_illustrations');
        steps.push('pdf_gift_table');
        if (formData.pdfGiftTable === 'mesa_experiencias') {
          steps.push('pdf_experiences');
        }
        steps.push('pdf_info');
        if (formData.pdfAdditionalInfo === true) {
          steps.push('pdf_info_categories');
          steps.push('pdf_info_options');
        }
        steps.push('pdf_personalized');
        steps.push('pdf_rsvp');
        steps.push('pdf_sending');
        steps.push('pdf_confirmation');
        // Show guest count if sending, confirmation, or personalized
        if (formData.pdfSending || formData.pdfConfirmation || formData.pdfPersonalized) {
          steps.push('pdf_guest_count');
        }
        steps.push('pdf_extras');
      }

      if (formData.invitationFormat === 'pagina_web') {
        steps.push('web_events');
        if (formData.webEventCount && formData.webEventCount > 1) {
          steps.push('web_pages');
        }
        steps.push('web_domain');
        steps.push('web_monogram');
        steps.push('web_design');
        steps.push('web_illustrations');
        steps.push('web_gift_table');
        if (formData.webGiftTable === 'mesa_experiencias') {
          steps.push('web_experiences');
        }
        steps.push('web_info');
        if (formData.webAdditionalInfo === true) {
          steps.push('web_info_categories');
          steps.push('web_info_options');
        }
        steps.push('web_rsvp');
        steps.push('web_extras');
        steps.push('web_sending');
        steps.push('web_confirmation');
        if (formData.webSending || formData.webConfirmation) {
          steps.push('web_guest_count');
        }
        steps.push('web_additional');
      }
    }

    if (formData.productType === 'save_the_date') {
      steps.push('std_format');
      steps.push('std_design');
      steps.push('std_sending');
      if (formData.stdSending) {
        steps.push('std_guest_count');
      }
    }

    if (formData.productType === 'envio_invitaciones') {
      steps.push('send_guest_count');
    }

    if (formData.productType === 'confirmaciones') {
      steps.push('confirm_guest_count');
    }

    return steps;
  }, [formData]);

  const totalSteps = stepKeys.length;
  const currentStepKey = stepKeys[currentStep] || 'contact';

  const goNext = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, stepKeys.length - 1));
  }, [stepKeys.length]);

  const goBack = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(0, Math.min(step, stepKeys.length - 1)));
  }, [stepKeys.length]);

  const canGoNext = useMemo(() => {
    // Validate current step
    switch (currentStepKey) {
      case 'contact':
        return formData.contactName.trim().length > 0 && formData.contactPhone.trim().replace(/\D/g, '').length >= 10;
      case 'referral':
        return formData.referralSource !== null &&
          (formData.referralSource !== 'wedding_planner' || formData.weddingPlannerName.trim().length > 0);
      case 'eventType':
        return formData.eventType !== null;
      case 'eventDate':
        return formData.eventDate.length > 0;
      case 'product':
        return formData.productType !== null;
      case 'format':
        return formData.invitationFormat !== null;
      case 'pdf_events':
        return formData.pdfMultipleEvents !== null;
      case 'pdf_sub_events':
        return formData.pdfSubEvents.length > 0;
      case 'pdf_guest_groups':
        return formData.pdfSameGuests !== null;
      case 'pdf_monogram':
        return formData.pdfMonogram !== null;
      case 'pdf_illustrations':
        return formData.pdfIllustrations !== null;
      case 'pdf_gift_table':
        return formData.pdfGiftTable !== null;
      case 'pdf_experiences':
        return formData.pdfExperienceTier !== null;
      case 'pdf_info':
        return formData.pdfAdditionalInfo !== null;
      case 'pdf_info_categories':
        return formData.pdfInfoCategories.length > 0;
      case 'pdf_info_options':
        return formData.pdfInfoOptionsCount !== null;
      case 'pdf_personalized':
        return formData.pdfPersonalized !== null;
      case 'pdf_rsvp':
        return formData.pdfRsvp !== null;
      case 'pdf_sending':
        return formData.pdfSending !== null;
      case 'pdf_confirmation':
        return formData.pdfConfirmation !== null;
      case 'pdf_guest_count':
        return formData.pdfGuestCountRange !== null;
      case 'pdf_extras':
        return formData.pdfAdditionalProducts.length > 0;
      case 'web_events':
        return formData.webEventCount !== null;
      case 'web_pages':
        return formData.webSeparatePages !== null;
      case 'web_domain':
        return formData.webDomainType !== null;
      case 'web_monogram':
        return formData.webMonogram !== null;
      case 'web_design':
        return formData.webDesignStyle !== null;
      case 'web_illustrations':
        return formData.webIllustrations !== null;
      case 'web_gift_table':
        return formData.webGiftTable !== null;
      case 'web_experiences':
        return formData.webExperienceTier !== null;
      case 'web_info':
        return formData.webAdditionalInfo !== null;
      case 'web_info_categories':
        return formData.webInfoCategories.length > 0;
      case 'web_info_options':
        return formData.webInfoOptionsCount !== null;
      case 'web_rsvp':
        return formData.webRsvp !== null;
      case 'web_extras':
        return true; // optional multi-select
      case 'web_sending':
        return formData.webSending !== null;
      case 'web_confirmation':
        return formData.webConfirmation !== null;
      case 'web_guest_count':
        return formData.webGuestCountRange !== null;
      case 'web_additional':
        return formData.webAdditionalProducts.length > 0;
      case 'std_format':
        return formData.stdFormat !== null;
      case 'std_design':
        return formData.stdDesignStyle !== null;
      case 'std_sending':
        return formData.stdSending !== null;
      case 'std_guest_count':
        return formData.stdGuestCountRange !== null;
      case 'send_guest_count':
        return formData.sendGuestCountRange !== null;
      case 'confirm_guest_count':
        return formData.confirmGuestCountRange !== null;
      default:
        return true;
    }
  }, [currentStepKey, formData]);

  const isLastStep = currentStep === stepKeys.length - 1;

  return {
    formData,
    updateField,
    updateFields,
    currentStep,
    currentStepKey,
    totalSteps,
    stepKeys,
    goNext,
    goBack,
    goToStep,
    canGoNext,
    isLastStep,
    priceBreakdown,
    isSubmitting,
    setIsSubmitting,
    isSubmitted,
    setIsSubmitted,
  };
}
