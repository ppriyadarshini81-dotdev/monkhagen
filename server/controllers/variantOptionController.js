const VariantOption = require('../models/VariantOption');
const asyncHandler = require('../middleware/asyncHandler');

module.exports = function createVariantOptionController(table, label) {
  return {
    list: asyncHandler(async (_req, res) => {
      res.json(await VariantOption.find(table, { activeOnly: true }));
    }),

    adminList: asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await VariantOption.find(table, { activeOnly: false }));
    }),

    create: asyncHandler(async (req, res) => {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ message: `${label} name is required.` });
      res.status(201).json(await VariantOption.create(table, name));
    }),

    update: asyncHandler(async (req, res) => {
      const data = {};
      if (req.body.name !== undefined) {
        data.name = String(req.body.name || '').trim();
        if (!data.name) return res.status(400).json({ message: `${label} name is required.` });
      }
      if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
      const option = await VariantOption.update(table, req.params.id, data);
      if (!option) return res.status(404).json({ message: `${label} not found.` });
      res.json(option);
    }),

    remove: asyncHandler(async (req, res) => {
      if (await VariantOption.usageCount(table, req.params.id)) {
        return res.status(409).json({ message: `${label} is used by a product and cannot be deleted.` });
      }
      const option = await VariantOption.remove(table, req.params.id);
      if (!option) return res.status(404).json({ message: `${label} not found.` });
      res.json({ message: `${label} deleted.`, id: option.id });
    })
  };
};
