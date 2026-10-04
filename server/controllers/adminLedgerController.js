const asyncHandler = require('../middleware/asyncHandler');
const FinancialLedger = require('../models/FinancialLedger');
const exportsService = require('../services/ledgerExportService');

exports.list = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [ledger, summary] = await Promise.all([
    FinancialLedger.list(req.query), FinancialLedger.summary(req.query)
  ]);
  res.json({ ...ledger, summary });
});

exports.detail = asyncHandler(async (req, res) => {
  const transaction = await FinancialLedger.findById(req.params.id);
  if (!transaction) return res.status(404).json({ message: 'Financial transaction not found.' });
  res.set('Cache-Control', 'no-store').json(transaction);
});

exports.exportExcel = asyncHandler(async (req, res) => {
  const { book } = await exportsService.workbook(req.query);
  const buffer = await book.xlsx.writeBuffer();
  res.set({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${exportsService.exportName(req.query)}"`,
    'X-Content-Type-Options': 'nosniff'
  });
  res.send(Buffer.from(buffer));
});
