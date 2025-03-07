// @ts-nocheck
import puppeteer from 'puppeteer';
import Handlebars from 'handlebars';
import fs from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import JsBarcode from 'jsbarcode';
import { Canvas } from 'canvas';
import path from 'path';
import { formatDate } from 'date-fns';

// Register Handlebars helpers
Handlebars.registerHelper('formatCurrency', (amount) => {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(Number(amount) || 0);
});

Handlebars.registerHelper('formatPhone', (phone) => {
  if (!phone) return '';
  return phone.toString().replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
});

// Load the invoice template
export const loadTemplate = async () => {
  try {
    const templatePath = path.join(__dirname, '../template/invoice-template.html');
    const templateContent = await fs.readFile(templatePath, 'utf8');
    return Handlebars.compile(templateContent);
  } catch (error) {
    console.error('Error loading template:', error);
    throw new Error('Failed to load invoice template');
  }
};

// Create a single invoice HTML
const createInvoiceHtml = (order, template) => {
  try {
    // Process order data
    const data = {
      // Customer information
      customerName: order.customerDetails?.get("name") || '',
      customerAddress: order.customerDetails?.get("address") || '',
      customerPincode: order.customerDetails?.get("pincode") || '',
      customerPhone: order.customerDetails?.get("phone") || '',
      
      // Order details
      orderBoxLength: order.orderBoxLength || '',
      orderBoxWidth: order.orderBoxWidth || '',
      orderBoxHeight: order.orderBoxHeight || '',
      orderWeight: order.orderWeight || '',
      orderWeightUnit: order.orderWeightUnit || 'kg',
      paymentMode: order.payment_mode === 0 ? "Prepaid" : "COD",
      isCOD: order.payment_mode === 1,
      amountToCollect: order.amount2Collect || 0,
      carrierName: order.carrierName || '',
      awb: order.awb || '',
      orderReferenceId: order.order_reference_id || '',
      
      // Generate barcode
      barcodeUrl: (() => {
        try {
          const canvas = new Canvas(200, 80);
          JsBarcode(canvas, order.awb || '0000000000', {
            format: 'CODE128',
            width: 1.7,
            displayValue: false
          });
          return canvas.toDataURL();
        } catch (err) {
          console.error('Barcode generation error:', err);
          return '';
        }
      })(),
      
      // Seller information
      sellerName: order.sellerDetails?.get("sellerName") || '',
      sellerAddress: order.sellerDetails?.get("sellerAddress") || order.pickupAddress?.address1 || '',
      rtoAddress: order.pickupAddress?.rtoAddress || order.pickupAddress?.address1 || '',
      rtoCity: order.pickupAddress?.rtoCity || order.pickupAddress?.city || '',
      rtoState: order.pickupAddress?.rtoState || order.pickupAddress?.state || '',
      companyLogoUrl: order.sellerId.companyProfile.companyLogo 
        ? `data:image/jpeg;base64,${order.sellerId.companyProfile.companyLogo}` 
        : 'https://lorrigo.in/_next/static/media/lorrigologo.e54a51f3.svg',
      lorrigoLogoUrl: 'https://lorrigo.in/_next/static/media/lorrigologo.e54a51f3.svg',
      productName: order.productId?.name || '',
      invoiceNumber: order.order_invoice_number || '',
      sellerGSTIN: order.sellerDetails?.get("sellerGSTIN") || '',
      
      // Add unique identifier to prevent duplication
      uniqueId: `order-${order._id || Math.random().toString(36).substring(2, 15)}`
    };
    
    // Apply template
    return template(data);
  } catch (error) {
    console.error('Error creating invoice HTML:', error);
    return '<div>Error generating invoice</div>';
  }
};

// Generate a single PDF invoice
export const generateSingleInvoice = async (order, template) => {
  let browser = null;
  
  try {
    const html = createInvoiceHtml(order, template);
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });
    
    return pdf;
  } catch (error) {
    console.error('Error generating single invoice PDF:', error);
    throw new Error('Failed to generate single invoice PDF');
  } finally {
    if (browser) await browser.close();
  }
};

// Generate multiple invoices with one per page
export const generateBulkInvoicesSinglePage = async (orders, template) => {
  let browser = null;
  
  try {
    const mergedPdf = await PDFDocument.create();
    
    // Create a PDF for each order
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    for (const order of orders) {
      const html = createInvoiceHtml(order, template);
      
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        }
      });
      
      // Add to merged PDF
      const singlePdf = await PDFDocument.load(pdf);
      const copiedPages = await mergedPdf.copyPages(singlePdf, singlePdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }
    
    const pdfBytes = await mergedPdf.save();
    
    return {
      pdfBuffer: Buffer.from(pdfBytes),
      filename: `Invoices_${orders.length}_Orders_${new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)}.pdf`
    };
  } catch (error) {
    console.error('Error generating bulk invoices:', error);
    throw new Error('Failed to generate bulk invoices');
  } finally {
    if (browser) await browser.close();
  }
};

// Generate multiple invoices with multiple labels per page
export const generateBulkInvoicesMultiplePerPage = async (orders, template, labelsPerPage = 4) => {
  let browser = null;
  
  try {
    const ORDERS_PER_PDF = 500; // Split into multiple PDFs if there are more than 500 orders
    const batches = [];
    
    for (let i = 0; i < orders.length; i += ORDERS_PER_PDF) {
      batches.push(orders.slice(i, i + ORDERS_PER_PDF));
    }
    
    const results = [];
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const mergedPdf = await PDFDocument.create();
      
      // Process in chunks based on labelsPerPage
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      for (let i = 0; i < batch.length; i += labelsPerPage) {
        const pageOrders = batch.slice(i, i + labelsPerPage);
        
        // Create custom layout for multiple labels per page
        let html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Shipping Labels</title>
            <style>
              body {
                margin: 0;
                padding: 0;
                font-family: Arial, sans-serif;
              }
              .page {
                display: grid;
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 1fr 1fr;
                gap: 0;
                height: 100vh;
                width: 100%;
              }
              .label-container {
                border: 1px solid #ddd;
                overflow: hidden;
                page-break-inside: avoid;
                box-sizing: border-box;
                position: relative;
              }
              /* Scale down the invoice content to fit */
              .label-container > div {
                transform: scale(0.95);
                transform-origin: top left;
                position: absolute;
                top: 10px;
                left: 10px;
              }
            </style>
          </head>
          <body>
            <div class="page">
        `;
        
        // Generate HTML for each label
        for (let j = 0; j < pageOrders.length; j++) {
          const order = pageOrders[j];
          const invoiceHtml = createInvoiceHtml(order, template);
          
          // Each label gets a unique container
          html += `
            <div class="label-container label-${j}">
              ${invoiceHtml}
            </div>
          `;
        }
        
        html += `
            </div>
          </body>
          </html>
        `;
        
        // Generate PDF for this page
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '5mm',
            right: '5mm',
            bottom: '5mm',
            left: '5mm'
          }
        });
        
        // Add to merged PDF
        const pagePdf = await PDFDocument.load(pdf);
        const copiedPages = await mergedPdf.copyPages(pagePdf, pagePdf.getPageIndices());
        copiedPages.forEach(page => mergedPdf.addPage(page));
      }
      
      await browser.close();
      browser = null;
      
      const pdfBytes = await mergedPdf.save();
      const startIndex = batchIndex * ORDERS_PER_PDF;
      const endIndex = Math.min(startIndex + ORDERS_PER_PDF, orders.length);
      
      results.push({
        pdfBuffer: Buffer.from(pdfBytes),
        filename: `Invoice_Batch_${batchIndex + 1}_Orders_${startIndex + 1}-${endIndex}_${new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)}.pdf`
      });
    }
    
    return results;
  } catch (error) {
    console.error('Error generating bulk invoices with multiple per page:', error);
    throw new Error('Failed to generate bulk invoices');
  } finally {
    if (browser) await browser.close();
  }
};


// Load the manifest template
export const loadManifestTemplate = async () => {
  try {
    const templatePath = path.join(__dirname, "../template/manifest-template.html")
    const templateContent = await fs.readFile(templatePath, "utf8")
    return Handlebars.compile(templateContent)
  } catch (error) {
    console.error("Error loading manifest template:", error)
    throw new Error("Failed to load manifest template")
  }
}
// Helper function to chunk array
export const chunkArray = (array, chunkSize) => {
  const chunks = []
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize))
  }
  return chunks
}

// Generate barcode as data URL
export const generateBarcodeDataUrl = (value) => {
  try {
    const canvas = new Canvas(200, 80)
    JsBarcode(canvas, value || "NOAWB", {
      format: "CODE128",
      width: 1.7,
      displayValue: false,
    })
    return canvas.toDataURL()
  } catch (err) {
    console.error("Barcode generation error:", err)
    return ""
  }
}

// Create a single manifest HTML
export const createManifestHtml = (orders, sellerName, courierName, manifestId, template) => {
  try {
    // Prepare data for template
    const templateData = {
      generatedDate: formatDate(new Date(), "dd/MM/yyyy, HH:mm a"),
      sellerName,
      courierName,
      manifestId,
      totalOrders: orders.length,
      orders: orders.map((order, idx) => {
        // Process product name
        let productName = "No Name Available"
        if (order.productId && order.productId.name) {
          productName =
            order.productId.name.length > 50 ? order.productId.name.slice(0, 55) + "..." : order.productId.name
        }

        // Generate barcode
        const barcodeUrl = generateBarcodeDataUrl(order.awb)

        return {
          index: idx + 1,
          order_reference_id: order.order_reference_id,
          awb: order.awb,
          productName,
          barcodeUrl,
        }
      }),
      lorrigoLogoUrl: "https://lorrigo.in/_next/static/media/lorrigologo.e54a51f3.svg",
    }

    // Apply template
    return template(templateData)
  } catch (error) {
    console.error("Error creating manifest HTML:", error)
    return "<div>Error generating manifest</div>"
  }
}

// Generate a single manifest PDF
export const generateSingleManifest = async (orders, sellerName, courierName, manifestId, template) => {
  let browser = null

  try {
    const html = createManifestHtml(orders, sellerName, courierName, manifestId, template)

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "networkidle0" })

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        right: "10mm",
        bottom: "10mm",
        left: "10mm",
      },
    })

    return pdf
  } catch (error) {
    console.error("Error generating single manifest PDF:", error)
    throw new Error("Failed to generate single manifest PDF")
  } finally {
    if (browser) await browser.close()
  }
}

export const groupOrdersByCourier = (orders) => {
  const groupedOrders = {}

  orders.forEach((order) => {
    if (!order.carrierName) return

    const key = order.carrierName
    if (!groupedOrders[key]) {
      groupedOrders[key] = []
    }
    groupedOrders[key].push(order)
  })

  return groupedOrders
}

// Generate bulk manifests
export const generateBulkManifests = async (orders, template) => {
  let browser = null

  try {
    // Group orders by courier
    const groupedOrders = groupOrdersByCourier(orders)
    const courierNames = Object.keys(groupedOrders)

    // Orders per page for readability
    const ORDERS_PER_PAGE = 50
    const allPdfBuffers = []

    // Generate PDFs for each courier and chunk
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })

    for (const courier of courierNames) {
      const courierOrders = groupedOrders[courier] || []
      if (courierOrders.length === 0) continue

      const orderChunks = chunkArray(courierOrders, ORDERS_PER_PAGE)
      const sellerName = courierOrders[0]?.sellerDetails?.sellerName || ""

      for (let i = 0; i < orderChunks.length; i++) {
        const chunk = orderChunks[i]
        const manifestId = `MANIFEST-${courier}-${i + 1}`

        const html = createManifestHtml(chunk, sellerName, courier, manifestId, template)

        const page = await browser.newPage()
        await page.setContent(html, { waitUntil: "networkidle0" })

        const pdf = await page.pdf({
          format: "A4",
         landscape: true, 
          printBackground: true,
          margin: {
            top: "5mm",
            right: "5mm",
            bottom: "5mm",
            left: "5mm",
          },
        })

        allPdfBuffers.push(pdf)
      }
    }

    // Merge all PDFs
    const mergedPdf = await PDFDocument.create()

    for (const pdfBuffer of allPdfBuffers) {
      try {
        const pdf = await PDFDocument.load(pdfBuffer)
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
        pages.forEach((page) => mergedPdf.addPage(page))
      } catch (error) {
        console.error("Error adding PDF:", error)
      }
    }

    const pdfBytes = await mergedPdf.save()

    return {
      pdfBuffer: Buffer.from(pdfBytes),
      filename: `Manifests_${orders.length}_Orders_${formatDate(new Date(), "yyyyMMdd_HHmm")}.pdf`,
    }
  } catch (error) {
    console.error("Error generating bulk manifests:", error)
    throw new Error("Failed to generate bulk manifests")
  } finally {
    if (browser) await browser.close()
  }
}

