import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotation } from '../../hooks/useQuotation';
import ContactInfoStep from './steps/ContactInfoStep';
import ReferralStep from './steps/ReferralStep';
import EventTypeStep from './steps/EventTypeStep';
import EventDateStep from './steps/EventDateStep';
import ProductSelectionStep from './steps/ProductSelectionStep';
import FormatSelectionStep from './steps/FormatSelectionStep';
import GenericRadioStep from './steps/GenericRadioStep';
import GenericCheckStep from './steps/GenericCheckStep';
import GuestCountStep from './steps/GuestCountStep';
import ThankYouStep from './steps/ThankYouStep';
import { LoadingScreen } from '../common/LoadingScreen';
// Images
import monogramImg from '../../assets/questions/Monograma.webp';
import elementsImg from '../../assets/questions/elementos.webp';
import designImg from '../../assets/questions/diseno.webp';
import stdBasicoImg from '../../assets/questions/STD Basico.webp';
import stdExtImg from '../../assets/questions/STD ext.webp';
import webImg from '../../assets/questions/Pag web.webp';
import pdfImg from '../../assets/questions/pdf interactivo.webp';
import heroImg from '../../assets/hero.png';
import bgImg from '../../assets/large-bg.jpeg';

import { supabase } from '../../lib/supabase';
import type { QuotationFormData, GuestCountRange, SubEvent, InfoCategory, WebExtra, AdditionalProduct, MonogramChoice, ExperienceTier, InfoOptionsCount, DesignStyle, GiftTableChoice } from '../../lib/quotation-types';

const IMAGES_TO_PRELOAD = [
  monogramImg,
  elementsImg,
  designImg,
  stdBasicoImg,
  stdExtImg,
  webImg,
  pdfImg,
  heroImg,
  bgImg
];

export default function QuotationWizard() {
  const { t } = useTranslation();
  const q = useQuotation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showIndicator, setShowIndicator] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // Asset pre-loading
  useEffect(() => {
    let loadedCount = 0;
    const total = IMAGES_TO_PRELOAD.length;

    const loadImage = (src: string) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.src = src;
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false); // Resolve even on error to not block forever
      });
    };

    const preload = async () => {
      for (const src of IMAGES_TO_PRELOAD) {
        await loadImage(src);
        loadedCount++;
        setLoadingProgress(loadedCount / total);
      }
      
      // Small artificial delay for smooth experience
      setTimeout(() => {
        setIsFadingOut(true);
        setTimeout(() => setIsLoaded(true), 600);
      }, 500);
    };

    preload();
  }, []);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const canScroll = scrollHeight > clientHeight;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 20; 
      setShowIndicator(canScroll && !isAtBottom);
    }
  };

  useEffect(() => {
    // Small timeout to ensure DOM is updated
    const timer = setTimeout(checkScroll, 100);
    window.addEventListener('resize', checkScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkScroll);
    };
  }, [q.currentStep, q.formData]); // Re-check if step or form data (which might change content) updates

  const handleSubmit = async () => {
    q.setIsSubmitting(true);
    try {
      // Create client
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .insert({
          name: q.formData.contactName,
          phone: q.formData.contactPhone,
          referral_source: q.formData.referralSource,
          wedding_planner: q.formData.weddingPlannerName || null,
          event_type: q.formData.eventType,
          event_date: q.formData.eventDate || null,
          lang: q.formData.lang,
        })
        .select()
        .single();

      if (clientError) throw clientError;

      // Determine product type for DB
      let dbProductType = q.formData.productType || '';
      if (q.formData.productType === 'invitacion_digital') {
        dbProductType = q.formData.invitationFormat || 'pdf_interactivo';
      }

      // Determine guest count range
      let guestRange = q.formData.pdfGuestCountRange
        || q.formData.webGuestCountRange
        || q.formData.stdGuestCountRange
        || q.formData.sendGuestCountRange
        || q.formData.confirmGuestCountRange
        || null;

      // Clean responses before submitting to remove stale data from "explored but changed" branches
      const responses: any = {
        contactName: q.formData.contactName,
        contactPhone: q.formData.contactPhone,
        referralSource: q.formData.referralSource,
        weddingPlannerName: q.formData.weddingPlannerName,
        eventType: q.formData.eventType,
        eventDate: q.formData.eventDate,
        productType: q.formData.productType,
        lang: q.formData.lang,
      };

      if (q.formData.productType === 'invitacion_digital') {
        responses.invitationFormat = q.formData.invitationFormat;
        if (q.formData.invitationFormat === 'pdf_interactivo') {
          Object.keys(q.formData).filter(k => k.startsWith('pdf')).forEach(k => {
            responses[k] = (q.formData as any)[k];
          });
        } else if (q.formData.invitationFormat === 'pagina_web') {
          Object.keys(q.formData).filter(k => k.startsWith('web')).forEach(k => {
            responses[k] = (q.formData as any)[k];
          });
        }
      } else if (q.formData.productType === 'save_the_date') {
        Object.keys(q.formData).filter(k => k.startsWith('std')).forEach(k => {
          responses[k] = (q.formData as any)[k];
        });
      } else if (q.formData.productType === 'envio_invitaciones') {
        responses.sendGuestCountRange = q.formData.sendGuestCountRange;
      } else if (q.formData.productType === 'confirmaciones') {
        responses.confirmGuestCountRange = q.formData.confirmGuestCountRange;
      }

      // Create quotation
      const { data: insertedQuotation, error: quotationError } = await supabase
        .from('quotations')
        .insert({
          client_id: client.id,
          product_type: dbProductType,
          base_price: q.priceBreakdown.basePrice,
          extras_price: q.priceBreakdown.subtotal - q.priceBreakdown.basePrice,
          total_price: q.priceBreakdown.estimatedTotal,
          responses: responses,
          price_breakdown: q.priceBreakdown,
          guest_count_range: guestRange,
          status: 'pendiente',
          document_status: 'generating'
        })
        .select('id')
        .single();

      if (quotationError) throw quotationError;

      // Trigger background document generation (fire-and-forget)
      supabase.functions.invoke('generate-quotation', {
        body: { quotation_id: insertedQuotation.id }
      }).catch(err => console.error("Background doc generation error:", err));

      q.setIsSubmitted(true);
    } catch (err) {
      console.error('Submit error:', err);
      alert(t('common.error'));
    } finally {
      q.setIsSubmitting(false);
    }
  };

  if (!isLoaded) {
    return <LoadingScreen progress={loadingProgress} isFadingOut={isFadingOut} />;
  }

  if (q.isSubmitted) {
    return (
      <div className="form-container animate-fade-in">
        <ThankYouStep />
      </div>
    );
  }

  const progress = ((q.currentStep + 1) / q.totalSteps) * 100;


  const renderStep = () => {
    const key = q.currentStepKey;

    switch (key) {
      case 'contact':
        return (
          <ContactInfoStep
            formData={q.formData}
            updateField={q.updateField}
            goNext={q.goNext}
            canGoNext={q.canGoNext}
          />
        );
      case 'referral':
        return <ReferralStep formData={q.formData} updateField={q.updateField} />;
      case 'eventType':
        return <EventTypeStep formData={q.formData} updateField={q.updateField} />;
      case 'eventDate':
        return <EventDateStep formData={q.formData} updateField={q.updateField} />;
      case 'product':
        return <ProductSelectionStep formData={q.formData} updateField={q.updateField} />;
      case 'format':
        return <FormatSelectionStep formData={q.formData} updateField={q.updateField} />;

      // ─── PDF Flow ───
      case 'pdf_events':
        return <GenericRadioStep<boolean>
          title={t('pdf.events_title')}
          options={[
            { value: false, label: t('pdf.events_single') },
            { value: true, label: t('pdf.events_multiple') },
          ]}
          selected={q.formData.pdfMultipleEvents}
          onSelect={(v) => q.updateField('pdfMultipleEvents', v)}
        />;
      case 'pdf_sub_events':
        return <GenericCheckStep<SubEvent>
          title={t('pdf.sub_events_title')}
          subtitle={t('pdf.sub_events_subtitle')}
          options={[
            { value: 'civil', label: t('pdf.civil'), price: t('pdf.sub_event_price') },
            { value: 'welcome', label: t('pdf.welcome'), price: t('pdf.sub_event_price') },
            { value: 'tornaboda', label: t('pdf.tornaboda'), price: t('pdf.sub_event_price') },
            { value: 'otro', label: t('pdf.otro'), price: t('pdf.sub_event_price') },
          ]}
          selected={q.formData.pdfSubEvents}
          onToggle={(v) => {
            const arr = q.formData.pdfSubEvents.includes(v)
              ? q.formData.pdfSubEvents.filter(x => x !== v)
              : [...q.formData.pdfSubEvents, v];
            q.updateField('pdfSubEvents', arr);
          }}
        />;
      case 'pdf_guest_groups':
        return <GenericRadioStep<boolean>
          title={t('pdf.guest_groups_title')}
          subtitle={t('pdf.guest_groups_desc')}
          options={[
            { value: true, label: t('pdf.guest_groups_yes') },
            { value: false, label: t('pdf.guest_groups_no'), price: t('pdf.guest_groups_no_price') },
          ]}
          selected={q.formData.pdfSameGuests}
          onSelect={(v) => q.updateField('pdfSameGuests', v)}
        />;
      case 'pdf_monogram':
        return <GenericRadioStep<MonogramChoice>
          title={t('pdf.monogram_title')}
          subtitle={t('pdf.monogram_desc')}
          questionImage={monogramImg}
          options={[
            { value: 'yes', label: t('pdf.monogram_yes'), price: t('pdf.monogram_yes_price') },
            { value: 'no', label: t('pdf.monogram_no') },
            { value: 'already_have', label: t('pdf.monogram_already') },
          ]}
          selected={q.formData.pdfMonogram}
          onSelect={(v) => q.updateField('pdfMonogram', v)}
        />;
      case 'pdf_illustrations':
        return <GenericRadioStep<boolean>
          title={t('pdf.illustrations_title')}
          subtitle={t('pdf.illustrations_desc')}
          questionImage={elementsImg}
          options={[
            { value: true, label: t('pdf.illustrations_yes'), price: t('pdf.illustrations_yes_price') },
            { value: false, label: t('pdf.illustrations_no') },
          ]}
          selected={q.formData.pdfIllustrations}
          onSelect={(v) => q.updateField('pdfIllustrations', v)}
        />;
      case 'pdf_gift_table':
        return <GenericCheckStep<GiftTableChoice>
          title={t('pdf.gift_table_title')}
          options={[
            { value: 'link_tienda', label: t('pdf.gift_link') },
            { value: 'transferencia', label: t('pdf.gift_transfer') },
            { value: 'mesa_experiencias', label: t('pdf.gift_experiences'), desc: t('pdf.gift_experiences_note') },
            { value: 'not_sure', label: t('pdf.gift_not_sure') },
          ]}
          selected={q.formData.pdfGiftTable}
          onToggle={(v) => {
            const current = q.formData.pdfGiftTable;
            if (current.includes(v)) {
              q.updateField('pdfGiftTable', current.filter(i => i !== v));
            } else {
              q.updateField('pdfGiftTable', [...current, v]);
            }
          }}
        />;
      case 'pdf_experiences':
        return <GenericRadioStep<ExperienceTier>
          title={t('pdf.experiences_title')}
          options={[
            { value: 'essential_10', label: t('pdf.exp_essential'), price: t('pdf.exp_essential_price') },
            { value: 'intermediate_20', label: t('pdf.exp_intermediate'), price: t('pdf.exp_intermediate_price') },
            { value: 'complete_30', label: t('pdf.exp_complete'), price: t('pdf.exp_complete_price') },
            { value: 'full_30plus', label: t('pdf.exp_full'), price: t('pdf.exp_full_price') },
          ]}
          selected={q.formData.pdfExperienceTier}
          onSelect={(v) => q.updateField('pdfExperienceTier', v)}
        />;
      case 'pdf_info':
        return <GenericRadioStep<boolean>
          title={t('pdf.info_title')}
          subtitle={t('pdf.info_desc')}
          options={[
            { value: true, label: t('pdf.info_yes') },
            { value: false, label: t('pdf.info_no') },
          ]}
          selected={q.formData.pdfAdditionalInfo}
          onSelect={(v) => q.updateField('pdfAdditionalInfo', v)}
        />;
      case 'pdf_info_categories':
        return <GenericCheckStep<InfoCategory>
          title={t('pdf.info_categories_title')}
          subtitle={t('pdf.info_categories_desc')}

          options={[
            { value: 'hospedaje', label: t('pdf.cat_hospedaje') },
            { value: 'transporte', label: t('pdf.cat_transporte') },
            { value: 'lugares', label: t('pdf.cat_lugares') },
            { value: 'belleza', label: t('pdf.cat_belleza') },
            { value: 'otro', label: t('pdf.cat_otro') },
          ]}
          selected={q.formData.pdfInfoCategories}
          onToggle={(v) => {
            const arr = q.formData.pdfInfoCategories.includes(v)
              ? q.formData.pdfInfoCategories.filter(x => x !== v)
              : [...q.formData.pdfInfoCategories, v];
            q.updateField('pdfInfoCategories', arr);
          }}
        />;
      case 'pdf_info_options':
        return <GenericRadioStep<InfoOptionsCount>
          title={t('pdf.info_options_title')}
          subtitle={t('pdf.info_options_desc')}
          options={[
            { value: '1_3', label: t('pdf.opt_1_3') },
            { value: '4_6', label: t('pdf.opt_4_6'), price: t('pdf.opt_4_6_price') },
            { value: '6_plus', label: t('pdf.opt_6_plus'), price: t('pdf.opt_6_plus_price') },
          ]}
          selected={q.formData.pdfInfoOptionsCount}
          onSelect={(v) => q.updateField('pdfInfoOptionsCount', v)}
        />;
      case 'pdf_personalized':
        return <GenericRadioStep<boolean>
          title={t('pdf.personalized_title')}
          subtitle={t('pdf.personalized_desc')}
          options={[
            { value: true, label: t('pdf.personalized_yes') },
            { value: false, label: t('pdf.personalized_no') },
          ]}
          selected={q.formData.pdfPersonalized}
          onSelect={(v) => q.updateField('pdfPersonalized', v)}
        />;
      case 'pdf_rsvp':
        return <GenericRadioStep<boolean>
          title={t('pdf.rsvp_title')}
          subtitle={`${t('pdf.rsvp_desc_1')}\n${t('pdf.rsvp_desc_2')}\n${t('pdf.rsvp_desc_3')}`}
          questionImage={designImg}
          options={[
            { value: true, label: t('pdf.rsvp_yes') },
            { value: false, label: t('pdf.rsvp_no') },
          ]}
          selected={q.formData.pdfRsvp}
          onSelect={(v) => q.updateField('pdfRsvp', v)}
        />;
      case 'pdf_sending':
        return <GenericRadioStep<boolean>
          title={t('pdf.sending_title')}
          subtitle={t('pdf.sending_desc')}
          note={t('pdf.sending_note')}
          options={[
            { value: true, label: t('pdf.sending_yes'), price: t('pdf.sending_yes_price') },
            { value: false, label: t('pdf.sending_no') },
          ]}
          selected={q.formData.pdfSending}
          onSelect={(v) => q.updateField('pdfSending', v)}
        />;
      case 'pdf_confirmation':
        return <GenericRadioStep<boolean>
          title={t('pdf.confirmation_title')}
          subtitle={t('pdf.confirmation_desc')}
          note={t('pdf.confirmation_note')}
          options={[
            { value: true, label: t('pdf.confirmation_yes'), price: t('pdf.confirmation_yes_price') },
            { value: false, label: t('pdf.confirmation_no') },
          ]}
          selected={q.formData.pdfConfirmation}
          onSelect={(v) => q.updateField('pdfConfirmation', v)}
        />;
      case 'pdf_guest_count':
        return <GuestCountStep
          title={t('pdf.guest_count_title')}
          note={t('pdf.guest_count_tip')}
          selected={q.formData.pdfGuestCountRange}
          onSelect={(v) => q.updateField('pdfGuestCountRange', v as GuestCountRange)}
        />;
      case 'pdf_extras':
        return <GenericCheckStep<AdditionalProduct>
          title={t('pdf.extras_title')}
          subtitle={t('pdf.extras_subtitle')}
          options={[
            { value: 'save_the_date', label: t('pdf.extra_std'), price: t('pdf.extra_std_price') },
            { value: 'pdf_adicional', label: t('pdf.extra_pdf'), price: t('pdf.extra_pdf_price') },
            { value: 'pagina_web_adicional', label: t('pdf.extra_web'), price: t('pdf.extra_web_price') },
            { value: 'our_moments', label: t('pdf.extra_moments') },
            { value: 'layout_mesas', label: t('pdf.extra_layout') },
            { value: 'none', label: t('pdf.extra_none') },
          ]}
          selected={q.formData.pdfAdditionalProducts}
          onToggle={(v) => {
            if (v === 'none') {
              q.updateField('pdfAdditionalProducts', ['none']);
              return;
            }
            let arr: AdditionalProduct[] = q.formData.pdfAdditionalProducts.filter(x => x !== 'none');
            arr = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
            if (arr.length === 0) arr = ['none'];
            q.updateField('pdfAdditionalProducts', arr);
          }}
        />;

      // ─── WEB Flow ─── (simplified - uses same generic components)
      case 'web_events':
        return <GenericRadioStep<number>
          title={t('web.events_title')}
          subtitle={t('web.events_desc')}
          options={[
            { value: 1, label: t('web.events_1') },
            { value: 2, label: t('web.events_2'), price: t('web.events_2_price') },
            { value: 3, label: t('web.events_3'), price: t('web.events_3_price') },
            { value: 4, label: t('web.events_4'), price: t('web.events_4_price') },
          ]}
          selected={q.formData.webEventCount}
          onSelect={(v) => q.updateField('webEventCount', v)}
        />;
      case 'web_pages':
        return <GenericRadioStep<boolean>
          title={t('web.pages_title')}
          options={[
            { value: false, label: t('web.pages_same') },
            { value: true, label: t('web.pages_separate'), price: t('web.pages_separate_price') },
          ]}
          selected={q.formData.webSeparatePages}
          onSelect={(v) => q.updateField('webSeparatePages', v)}
        />;
      case 'web_domain':
        return <GenericRadioStep<'generic' | 'custom'>
          title={t('web.domain_title')}
          options={[
            { value: 'generic', label: t('web.domain_generic'), desc: t('web.domain_generic_desc') },
            { value: 'custom', label: t('web.domain_custom'), desc: t('web.domain_custom_desc'), price: t('web.domain_custom_price') },
          ]}
          selected={q.formData.webDomainType}
          onSelect={(v) => q.updateField('webDomainType', v)}
        />;
      case 'web_monogram':
        return <GenericRadioStep<MonogramChoice>
          title={t('pdf.monogram_title')}
          subtitle={t('pdf.monogram_desc')}
          questionImage={monogramImg}
          options={[
            { value: 'yes', label: t('pdf.monogram_yes'), price: t('pdf.monogram_yes_price') },
            { value: 'no', label: t('pdf.monogram_no') },
            { value: 'already_have', label: t('pdf.monogram_already') },
          ]}
          selected={q.formData.webMonogram}
          onSelect={(v) => q.updateField('webMonogram', v)}
        />;
      case 'web_design':
        return <GenericRadioStep<DesignStyle>
          title={t('web.design_title')}
          options={[
            { value: 'photos', label: t('web.design_photos'), desc: t('web.design_photos_desc') },
            { value: 'graphic', label: t('web.design_graphic'), desc: t('web.design_graphic_desc'), price: t('web.design_graphic_price') },
            { value: 'mixed', label: t('web.design_mixed'), desc: t('web.design_mixed_desc'), price: t('web.design_mixed_price') },
            { value: 'unsure', label: t('web.design_unsure'), desc: t('web.design_unsure_desc') },
          ]}
          selected={q.formData.webDesignStyle}
          onSelect={(v) => q.updateField('webDesignStyle', v)}
        />;
      case 'web_illustrations':
        return <GenericRadioStep<boolean>
          title={t('pdf.illustrations_title')}
          subtitle={t('pdf.illustrations_desc')}
          questionImage={elementsImg}
          options={[
            { value: true, label: t('pdf.illustrations_yes'), price: t('pdf.illustrations_yes_price') },
            { value: false, label: t('pdf.illustrations_no') },
          ]}
          selected={q.formData.webIllustrations}
          onSelect={(v) => q.updateField('webIllustrations', v)}
        />;
      case 'web_gift_table':
        return <GenericCheckStep<GiftTableChoice>
          title={t('pdf.gift_table_title')}
          options={[
            { value: 'link_tienda', label: t('pdf.gift_link') },
            { value: 'transferencia', label: t('pdf.gift_transfer') },
            { value: 'mesa_experiencias', label: t('pdf.gift_experiences'), desc: t('pdf.gift_experiences_note') },
            { value: 'not_sure', label: t('pdf.gift_not_sure') },
          ]}
          selected={q.formData.webGiftTable}
          onToggle={(v) => {
            const current = q.formData.webGiftTable;
            if (current.includes(v)) {
              q.updateField('webGiftTable', current.filter(i => i !== v));
            } else {
              q.updateField('webGiftTable', [...current, v]);
            }
          }}
        />;
      case 'web_experiences':
        return <GenericRadioStep<ExperienceTier>
          title={t('pdf.experiences_title')}
          options={[
            { value: 'essential_10', label: t('pdf.exp_essential'), price: t('pdf.exp_essential_price') },
            { value: 'intermediate_20', label: t('pdf.exp_intermediate'), price: t('pdf.exp_intermediate_price') },
            { value: 'complete_30', label: t('pdf.exp_complete'), price: t('pdf.exp_complete_price') },
            { value: 'full_30plus', label: t('pdf.exp_full'), price: t('pdf.exp_full_price') },
          ]}
          selected={q.formData.webExperienceTier}
          onSelect={(v) => q.updateField('webExperienceTier', v)}
        />;
      case 'web_info':
        return <GenericRadioStep<boolean>
          title={t('pdf.info_title')}
          subtitle={t('pdf.info_desc')}
          options={[
            { value: true, label: t('pdf.info_yes') },
            { value: false, label: t('pdf.info_no') },
          ]}
          selected={q.formData.webAdditionalInfo}
          onSelect={(v) => q.updateField('webAdditionalInfo', v)}
        />;
      case 'web_info_categories':
        return <GenericCheckStep<InfoCategory>
          title={t('pdf.info_categories_title')}
          subtitle={t('pdf.info_categories_desc')}

          options={[
            { value: 'hospedaje', label: t('pdf.cat_hospedaje') },
            { value: 'restaurantes' as InfoCategory, label: t('web.cat_restaurantes') },
            { value: 'transporte', label: t('pdf.cat_transporte') },
            { value: 'lugares', label: t('pdf.cat_lugares') },
            { value: 'belleza', label: t('pdf.cat_belleza') },
            { value: 'otro', label: t('pdf.cat_otro') },
          ]}
          selected={q.formData.webInfoCategories}
          onToggle={(v) => {
            const arr = q.formData.webInfoCategories.includes(v)
              ? q.formData.webInfoCategories.filter(x => x !== v)
              : [...q.formData.webInfoCategories, v];
            q.updateField('webInfoCategories', arr);
          }}
        />;
      case 'web_info_options':
        return <GenericRadioStep<InfoOptionsCount>
          title={t('pdf.info_options_title')}
          options={[
            { value: '1_3', label: t('pdf.opt_1_3') },
            { value: '4_6', label: t('pdf.opt_4_6'), price: t('web.info_opt_4_6_price') },
            { value: '6_plus', label: t('pdf.opt_6_plus'), price: t('web.info_opt_6_plus_price') },
          ]}
          selected={q.formData.webInfoOptionsCount}
          onSelect={(v) => q.updateField('webInfoOptionsCount', v)}
        />;
      case 'web_rsvp':
        return <GenericRadioStep<boolean>
          title={t('pdf.rsvp_title')}
          subtitle={`${t('pdf.rsvp_desc_1')}\n${t('pdf.rsvp_desc_2')}\n${t('pdf.rsvp_desc_3')}`}
          questionImage={designImg}
          options={[
            { value: true, label: t('pdf.rsvp_yes') },
            { value: false, label: t('pdf.rsvp_no') },
          ]}
          selected={q.formData.webRsvp}
          onSelect={(v) => q.updateField('webRsvp', v)}
        />;
      case 'web_extras':
        return <GenericCheckStep<WebExtra>
          title={t('web.extras_title')}
          subtitle={t('web.extras_desc')}
          options={[
            { value: 'bilingue', label: t('web.extra_bilingue'), desc: t('web.extra_bilingue_desc'), price: t('web.extra_bilingue_price') },
            { value: 'password', label: t('web.extra_password'), desc: t('web.extra_password_desc'), price: t('web.extra_password_price') },
            { value: 'clima', label: t('web.extra_clima'), desc: t('web.extra_clima_desc'), price: t('web.extra_clima_price') },
          ]}
          selected={q.formData.webExtras}
          onToggle={(v) => {
            const arr = q.formData.webExtras.includes(v)
              ? q.formData.webExtras.filter(x => x !== v)
              : [...q.formData.webExtras, v];
            q.updateField('webExtras', arr);
          }}
        />;
      case 'web_sending':
        return <GenericRadioStep<boolean>
          title={t('pdf.sending_title')}
          subtitle={t('pdf.sending_desc')}
          note={t('pdf.sending_note')}
          options={[
            { value: true, label: t('pdf.sending_yes'), price: t('pdf.sending_yes_price') },
            { value: false, label: t('pdf.sending_no') },
          ]}
          selected={q.formData.webSending}
          onSelect={(v) => q.updateField('webSending', v)}
        />;
      case 'web_confirmation':
        return <GenericRadioStep<boolean>
          title={t('pdf.confirmation_title')}
          subtitle={t('pdf.confirmation_desc')}
          note={t('pdf.confirmation_note')}
          options={[
            { value: true, label: t('pdf.confirmation_yes'), price: t('pdf.confirmation_yes_price') },
            { value: false, label: t('pdf.confirmation_no') },
          ]}
          selected={q.formData.webConfirmation}
          onSelect={(v) => q.updateField('webConfirmation', v)}
        />;
      case 'web_guest_count':
        return <GuestCountStep
          title={t('pdf.guest_count_title')}
          note={t('pdf.guest_count_tip')}
          selected={q.formData.webGuestCountRange}
          onSelect={(v) => q.updateField('webGuestCountRange', v as GuestCountRange)}
        />;
      case 'web_additional':
        return <GenericCheckStep<AdditionalProduct>
          title={t('pdf.extras_title')}
          subtitle={t('pdf.extras_subtitle')}
          options={[
            { value: 'save_the_date', label: t('pdf.extra_std'), price: t('pdf.extra_std_price') },
            { value: 'pdf_adicional', label: t('pdf.extra_pdf'), price: t('pdf.extra_pdf_price') },
            { value: 'our_moments', label: t('pdf.extra_moments') },
            { value: 'layout_mesas', label: t('pdf.extra_layout') },
            { value: 'none', label: t('pdf.extra_none') },
          ]}
          selected={q.formData.webAdditionalProducts}
          onToggle={(v) => {
            if (v === 'none') {
              q.updateField('webAdditionalProducts', ['none']);
              return;
            }
            let arr: AdditionalProduct[] = q.formData.webAdditionalProducts.filter(x => x !== 'none');
            arr = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
            if (arr.length === 0) arr = ['none'];
            q.updateField('webAdditionalProducts', arr);
          }}
        />;

      // ─── STD Flow ───
      case 'std_format':
        return <GenericRadioStep<string>
          title={t('std.format_title')}
          options={[
            { value: 'basico', label: t('std.format_basico'), desc: t('std.format_basico_desc'), price: t('std.format_basico_price'), image: stdBasicoImg },
            { value: 'extendido', label: t('std.format_extendido'), desc: t('std.format_extendido_desc'), price: t('std.format_extendido_price'), image: stdExtImg },
          ]}
          selected={q.formData.stdFormat}
          onSelect={(v) => q.updateField('stdFormat', v as QuotationFormData['stdFormat'])}
        />;
      case 'std_design':
        return <GenericRadioStep<DesignStyle>
          title={t('std.design_title')}
          options={[
            { value: 'photos', label: t('web.design_photos'), desc: t('web.design_photos_desc') },
            { value: 'graphic', label: t('web.design_graphic'), desc: t('web.design_graphic_desc') },
            { value: 'mixed', label: t('web.design_mixed'), desc: t('web.design_mixed_desc') },
          ]}
          selected={q.formData.stdDesignStyle}
          onSelect={(v) => q.updateField('stdDesignStyle', v)}
        />;
      case 'std_sending':
        return <GenericRadioStep<boolean>
          title={t('std.sending_title')}
          subtitle={t('std.sending_desc')}
          note={t('std.sending_note')}
          options={[
            { value: true, label: t('pdf.sending_yes'), price: t('std.sending_yes_price') },
            { value: false, label: t('pdf.sending_no') },
          ]}
          selected={q.formData.stdSending}
          onSelect={(v) => q.updateField('stdSending', v)}
        />;
      case 'std_guest_count':
        return <GuestCountStep
          title={t('pdf.guest_count_title')}
          note={t('pdf.guest_count_tip')}
          selected={q.formData.stdGuestCountRange}
          onSelect={(v) => q.updateField('stdGuestCountRange', v as GuestCountRange)}
        />;

      // ─── Send / Confirm only ───
      case 'send_guest_count':
        return <GuestCountStep
          title={t('send.guest_count_title')}
          note={t('pdf.guest_count_tip')}
          selected={q.formData.sendGuestCountRange}
          onSelect={(v) => q.updateField('sendGuestCountRange', v as GuestCountRange)}
        />;
      case 'confirm_guest_count':
        return <GuestCountStep
          title={t('confirm.guest_count_title')}
          note={t('pdf.guest_count_tip')}
          selected={q.formData.confirmGuestCountRange}
          onSelect={(v) => q.updateField('confirmGuestCountRange', v as GuestCountRange)}
        />;

      default:
        return <div>Step: {key}</div>;
    }
  };

  return (
    <>
      <div style={{ width: '100%', padding: '0 24px' }}>
        <div className="progress-bar" style={{ maxWidth: 'var(--max-form-width)', margin: '0 auto' }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="form-container">
        <div className="step-counter">
          {t('common.step')} {q.currentStep + 1} {t('common.of')} {q.totalSteps}
        </div>

        <div className="step-content-wrapper">
          <div 
            ref={scrollRef}
            key={q.currentStepKey} 
            className="animate-fade-in step-content-scroll"
            onScroll={checkScroll}
          >
            {renderStep()}
          </div>
          <div className={`scroll-gradient ${showIndicator ? 'visible' : ''}`} />
        </div>

        <div className="step-footer">
          {q.currentStep > 0 ? (
            <button className="btn btn-secondary" onClick={q.goBack}>
              ← {t('common.back')}
            </button>
          ) : <div />}

          {q.isLastStep ? (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!q.canGoNext || q.isSubmitting}
            >
              {q.isSubmitting ? t('common.loading') : t('common.submit')} →
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={q.goNext}
              disabled={!q.canGoNext}
            >
              {t('common.next')} →
            </button>
          )}
        </div>
      </div>


    </>
  );
}
