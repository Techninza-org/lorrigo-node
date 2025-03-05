import { ExtendedRequest } from "../utils/middleware";
import { Response } from 'express';
import { generateBulkInvoicesMultiplePerPage, generateBulkInvoicesSinglePage, generateBulkManifests, generateSingleInvoice, generateSingleManifest, loadManifestTemplate, loadTemplate } from "../utils/template-generator-helper";
import { B2COrderModel } from "../models/order.model";

export const generateInvoices = async (req: ExtendedRequest, res: Response) => {
  let browser = null;

  try {
    let orders: any[] = [];
    const options = req.body.options || {};
    const isBulk = req.query.bulk === "true"
    const sellerId = req.seller._id

    const today = new Date();
    const last7Day = new Date(today.getDate() - 7)
    if (!isBulk && req.body.orderIds && Array.isArray(req.body.orderIds)) {
      orders = await B2COrderModel.find({ _id: { $in: req.body.orderIds } }).populate("pickupAddress productId");
    } else if (isBulk) {
      orders = await B2COrderModel.find({
        sellerId: sellerId,
        bucket: 1,
        awb: { $exists: true },
        createdAt: { $gte: last7Day }
      }).populate("pickupAddress productId");
    }

    console.log(`Total orders found: ${orders.length}`);

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid orders found' });
    }

    const template = await loadTemplate();

    if (orders.length === 1 || options.forceSinglePage) {
      // if (orders.length === 1) {
      //   const pdf = await generateSingleInvoice(orders[0], template);

      //   // Validate PDF before sending
      //   if (!pdf || pdf.byteLength === 0) {
      //     return res.status(500).json({
      //       success: false,
      //       error: 'Failed to generate PDF'
      //     });
      //   }

      //   res.setHeader('Content-Type', 'application/pdf');
      //   res.setHeader('Content-Disposition', `attachment; filename="Invoice_${orders[0].order_reference_id || 'order'}_${Date.now()}.pdf"`);
      //   return res.send(pdf);
      // } else {
      const result = await generateBulkInvoicesSinglePage(orders, template);

      // Validate PDF before sending
      if (!result.pdfBuffer || result.pdfBuffer.byteLength === 0) {
        return res.status(500).json({
          success: false,
          error: 'Failed to generate bulk PDF'
        });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.send(result.pdfBuffer);
      // }
    } else {
      const labelsPerPage = options.labelsPerPage || 4;
      const pdfResults = await generateBulkInvoicesMultiplePerPage(orders, template, labelsPerPage);

      if (pdfResults.length === 1) {
        // Validate single PDF
        if (!pdfResults[0].pdfBuffer || pdfResults[0].pdfBuffer.byteLength === 0) {
          return res.status(500).json({
            success: false,
            error: 'Failed to generate single PDF'
          });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${pdfResults[0].filename}"`);
        return res.send(pdfResults[0].pdfBuffer);
      } else {
        // Additional validation for multiple PDFs
        const validPdfs = pdfResults.filter(result =>
          result.pdfBuffer && result.pdfBuffer.byteLength > 0
        );

        if (validPdfs.length === 0) {
          return res.status(500).json({
            success: false,
            error: 'No valid PDFs generated'
          });
        }

        // Use Buffer.from() to correctly encode base64
        const response = validPdfs.map(result => ({
          filename: result.filename,
          pdfBase64: result.pdfBuffer.toString('base64')
        }));

        return res.json({ success: true, pdfs: response });
      }
    }
  } catch (error: any) {
    console.error('Error in invoice generation controller:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate invoices',
      message: error.message
    });
  } finally {
    // @ts-ignore
    if (browser) await browser.close();
  }
};

export const generateManifests = async (req: ExtendedRequest, res: Response) => {
  const browser = null

  try {
    let orders;
    const options = req.body.options || {};
    const isBulk = req.query.bulk === "true"
    const sellerId = req.seller._id

    console.log(isBulk, "isBulk")

    if (!isBulk && req.body.orderIds && Array.isArray(req.body.orderIds)) {
      orders = await B2COrderModel.find({ _id: { $in: req.body.orderIds } }).populate("pickupAddress productId");
    } else {
      orders = await B2COrderModel.find({
        sellerId: sellerId,
        bucket: 1,
        awb: { $exists: true }
      }).limit(options.limit || 100).populate("pickupAddress productId");
    }

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, error: "No valid orders found" })
    }

    const template = await loadManifestTemplate()

    // For single courier manifest
    if (options.singleCourier && options.courierName) {
      const filteredOrders = orders.filter((order) => order.carrierName === options.courierName)

      if (filteredOrders.length === 0) {
        return res.status(400).json({
          success: false,
          error: `No orders found for courier: ${options.courierName}`,
        })
      }

      // @ts-ignore
      const sellerName = filteredOrders[0]?.sellerDetails?.sellerName || ""
      const manifestId = options.manifestId || `MANIFEST-${options.courierName}-${Date.now()}`

      const pdf = await generateSingleManifest(filteredOrders, sellerName, options.courierName, manifestId, template)

      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="Manifest_${options.courierName}_${Date.now()}.pdf"`)
      return res.send(pdf)
    }
    // For bulk manifests (grouped by courier)
    else {
      const result = await generateBulkManifests(orders, template)

      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`)
      return res.send(result.pdfBuffer)
    }
  } catch (error: any) {
    console.error("Error in manifest generation controller:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to generate manifests",
      message: error.message,
    })
  } finally {
    // @ts-ignore
    if (browser) await browser.close()
  }
}
