const ExcelJS = require('exceljs');
const FinancialLedger = require('../models/FinancialLedger');

function exportName(query = {}, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  if (query.dateFrom && query.dateTo) return `monk-hagen-ledger-${query.dateFrom}-to-${query.dateTo}.xlsx`;
  return `monk-hagen-ledger-${day}.xlsx`;
}

async function workbook(query = {}, database) {
  const [transactions, totals] = await Promise.all([
    FinancialLedger.all(query, database), FinancialLedger.summary(query, database)
  ]);
  const book = new ExcelJS.Workbook();
  book.creator = 'Monk Hagen';
  book.created = new Date();
  const sheet = book.addWorksheet('Ledger', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    ['Transaction Date', 21], ['Order ID', 25], ['Invoice Number', 18], ['Customer Name', 24],
    ['Customer Email', 30], ['Customer Phone', 18], ['Transaction Type', 18], ['Direction', 12],
    ['Credit', 14], ['Debit', 14], ['Currency', 10], ['Status', 12], ['Payment Method', 18],
    ['Return ID', 25], ['Provider', 14], ['Provider Reference', 28], ['Description', 44]
  ].map(([header, width]) => ({ header, key: String(header).replace(/\s/g, ''), width }));
  for (const tx of transactions) {
    sheet.addRow({
      TransactionDate: new Date(tx.occurredAt), OrderID: tx.orderNumber, InvoiceNumber: tx.invoiceNumber,
      CustomerName: tx.customer.name, CustomerEmail: tx.customer.email, CustomerPhone: tx.customer.phone,
      TransactionType: tx.type, Direction: tx.direction,
      Credit: tx.direction === 'CREDIT' ? tx.amount : null, Debit: tx.direction === 'DEBIT' ? tx.amount : null,
      Currency: tx.currency, Status: tx.status, PaymentMethod: tx.paymentMethod,
      ReturnID: tx.returnNumber, Provider: tx.provider, ProviderReference: tx.providerReferenceId,
      Description: tx.description
    });
  }
  sheet.autoFilter = { from: 'A1', to: 'Q1' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2140E6' } };
  sheet.getColumn('TransactionDate').numFmt = 'dd mmm yyyy hh:mm';
  sheet.getColumn('Credit').numFmt = '₹#,##0.00';
  sheet.getColumn('Debit').numFmt = '₹#,##0.00';

  const summary = book.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  summary.columns = [{ header: 'Metric', key: 'metric', width: 34 }, { header: 'Value', key: 'value', width: 24 }];
  summary.addRows([
    { metric: 'Export Date', value: new Date() },
    { metric: 'Selected Date Range', value: query.dateFrom || query.dateTo ? `${query.dateFrom || 'Beginning'} to ${query.dateTo || 'Present'}` : 'All dates' },
    { metric: 'Successful Credits', value: totals.successfulCredits },
    { metric: 'Successful Debits', value: totals.successfulDebits },
    { metric: 'Net Successful Amount', value: totals.netSuccessfulAmount },
    { metric: 'Pending Refunds', value: totals.pendingRefunds },
    { metric: 'Failed Transaction Count', value: totals.failedTransactionCount }
  ]);
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2140E6' } };
  summary.getCell('B2').numFmt = 'dd mmm yyyy hh:mm';
  for (const row of [4, 5, 6, 7]) summary.getCell(`B${row}`).numFmt = '₹#,##0.00';
  return { book, transactions, totals };
}

module.exports = { workbook, exportName };
