import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "npm:googleapis@133";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let parsedQuotationId: string | null = null;
  try {
    const { quotation_id } = await req.json();
    parsedQuotationId = quotation_id;
    if (!quotation_id) {
      throw new Error("quotation_id is required");
    }

    // 1. Init Supabase to fetch quotation data (Usar SERVICE_ROLE para bypass RLS y evitar problemas de permisos al actualizar)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: quotation, error: qError } = await supabaseClient
      .from('quotations')
      .select('*, client:clients(*)')
      .eq('id', quotation_id)
      .single();

    if (qError || !quotation) {
      throw new Error("Quotation not found");
    }

    // 2. Auth with Google
    const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    const rootFolderId = Deno.env.get('DRIVE_ROOT_FOLDER_ID');

    if (!clientEmail || !privateKey || !rootFolderId) {
      throw new Error("Google Credentials or Root Folder ID missing in ENV");
    }

    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/presentations', 'https://www.googleapis.com/auth/documents']
    );

    const drive = google.drive({ version: 'v3', auth });
    const slides = google.slides({ version: 'v1', auth });
    const docs = google.docs({ version: 'v1', auth });

    // 3. Determine template ID
    let templateId = '';
    const type = quotation.product_type;
    const format = quotation.responses?.invitationFormat;
    
    if (type === 'invitacion_digital' && format === 'pagina_web') {
      templateId = Deno.env.get('TEMPLATE_ID_WEBSITE') || '';
    } else if (type === 'invitacion_digital' && format === 'pdf_interactivo') {
      templateId = Deno.env.get('TEMPLATE_ID_PDF') || '';
    } else if (type === 'save_the_date') {
      templateId = Deno.env.get('TEMPLATE_ID_STD') || '';
    } else if (type === 'envio_invitaciones') {
      templateId = Deno.env.get('TEMPLATE_ID_ENVIO') || '';
    } else {
      // Default to PDF if not sure
      templateId = Deno.env.get('TEMPLATE_ID_PDF') || '';
    }

    if (!templateId) {
      throw new Error(`Template ID not found for this product type: ${type} ${format}`);
    }

    // 4. Create Client Folder
    const folderName = `${quotation.client.name} - ${quotation.client.event_type} - ${quotation.id.slice(0, 6)}`;
    let clientFolderId = null;
    
    try {
      const searchRes = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${rootFolderId}' in parents and trashed=false`,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      clientFolderId = searchRes.data.files && searchRes.data.files.length > 0 ? searchRes.data.files[0].id : null;

      if (!clientFolderId) {
        const folderRes = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [rootFolderId]
          },
          fields: 'id',
          supportsAllDrives: true,
        });
        clientFolderId = folderRes.data.id;
      }
    } catch (e: any) {
      throw new Error(`Error en Paso 4 (Crear Carpeta): ${e.message}`);
    }

    // 5. Create Raw Responses Doc using Drive API directly to set parents
    let docId = '';
    
    try {
      const docRes = await drive.files.create({
        requestBody: { 
          name: `Respuestas Formulario - ${quotation.client.name}`,
          mimeType: 'application/vnd.google-apps.document',
          parents: [clientFolderId as string]
        },
        fields: 'id',
        supportsAllDrives: true
      });
      docId = docRes.data.id as string;
    } catch (e: any) {
      throw new Error(`Error en Paso 5.1 (Crear Doc en Drive): ${e.message}`);
    }

    try {
      const requests: any[] = [];
      const responsesText = JSON.stringify(quotation.responses, null, 2);
      requests.push({
        insertText: {
          location: { index: 1 },
          text: `Respuestas de Cotización\n\nID: ${quotation.id}\nCliente: ${quotation.client.name}\n\nDatos:\n${responsesText}\n`
        }
      });
      await docs.documents.batchUpdate({
        documentId: docId as string,
        requestBody: { requests }
      });
    } catch (e: any) {
      throw new Error(`Error en Paso 5.2 (Escribir texto en el Doc): ${e.message}`);
    }

    // 6. Copy Template PPTX
    let newPptxId = '';
    let driveUrl = '';
    try {
      const copyRes = await drive.files.copy({
        fileId: templateId,
        requestBody: {
          name: `Cotización - ${quotation.client.name}`,
          parents: [clientFolderId as string]
        },
        fields: 'id, webViewLink',
        supportsAllDrives: true,
      });
      newPptxId = copyRes.data.id as string;
      driveUrl = copyRes.data.webViewLink as string;
    } catch (e: any) {
      throw new Error(`Error en Paso 6 (Drive copy template ${templateId}): ${e.message}`);
    }

    // 7. Replace Variables in Slides
    try {
      const formatCurrency = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }).format(n);
      
      const bd = quotation.price_breakdown;
      const anticipoVal = (quotation.total_price * 0.5); 
      
      const envioItem = bd?.perGuestItems?.find((i: any) => i.key.includes('sending') || i.key.includes('envio'));
      const envioPriceText = envioItem ? formatCurrency(envioItem.estimatedTotal) : "$0.00";

      const replacements = [
        { text: '{{name}}', replaceWith: quotation.client.name },
        { text: '{{sub_total}}', replaceWith: formatCurrency(bd?.subtotal || quotation.total_price) },
        { text: '{{descuento}}', replaceWith: '$0.00' }, 
        { text: '{{anticipo}}', replaceWith: formatCurrency(anticipoVal) },
        { text: '{{entrega}}', replaceWith: formatCurrency(quotation.total_price - anticipoVal) },
        { text: '{{envio}}', replaceWith: envioPriceText },
        { text: '{{invitados}}', replaceWith: quotation.responses?.pdfGuestCountRange || quotation.responses?.webGuestCountRange || 'N/A' },
      ];

      const slideRequests = replacements.map(r => ({
        replaceAllText: {
          containsText: { text: r.text, matchCase: true },
          replaceText: String(r.replaceWith)
        }
      }));

      await slides.presentations.batchUpdate({
        presentationId: newPptxId as string,
        requestBody: { requests: slideRequests }
      });
    } catch (e: any) {
      throw new Error(`Error en Paso 7 (Slides API batchUpdate): ${e.message}`);
    }

    // 8. Generate and Upload PDF
    let finalPdfUrl = '';
    try {
      // Small delay to allow Google Drive to fully sync the updated Slides file before exporting
      await new Promise(resolve => setTimeout(resolve, 2000));

      const pdfExport = await drive.files.export({
        fileId: newPptxId,
        mimeType: 'application/pdf',
        supportsAllDrives: true
      }, { responseType: 'arraybuffer' });

      // Convert array buffer to Node Readable stream for googleapis
      const pdfBuffer = Buffer.from(pdfExport.data as ArrayBuffer);
      const stream = Readable.from(pdfBuffer);

      const pdfUpload = await drive.files.create({
        requestBody: {
          name: `Cotización - ${quotation.client.name}.pdf`,
          mimeType: 'application/pdf',
          parents: [clientFolderId as string]
        },
        media: {
          mimeType: 'application/pdf',
          body: stream
        },
        fields: 'id, webViewLink',
        supportsAllDrives: true
      });
      
      const uploadedPdfId = pdfUpload.data.id as string;
      finalPdfUrl = pdfUpload.data.webViewLink as string;

      // Make PDF public viewable
      await drive.permissions.create({
        fileId: uploadedPdfId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        },
        supportsAllDrives: true
      });
    } catch (e: any) {
      throw new Error(`Error en Paso 8 (Generar y subir PDF): ${e.message}`);
    }

    // 9. Update Quotation Database (Exito)
    try {
      const { error: updateError } = await supabaseClient.from('quotations').update({
        drive_document_url: driveUrl,
        document_pdf_url: finalPdfUrl,
        document_status: 'completed',
        document_error: null
      }).eq('id', quotation_id);
      
      if (updateError) throw updateError;
    } catch (e: any) {
      throw new Error(`Error en Paso 9 (Actualizar Supabase DB): ${e.message}`);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      folderId: clientFolderId,
      pptxUrl: driveUrl,
      pdfUrl: finalPdfUrl
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    try {
      if (parsedQuotationId) {
         const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        await supabaseClient.from('quotations').update({
          document_status: 'failed',
          document_error: error.message
        }).eq('id', parsedQuotationId);
      }
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
