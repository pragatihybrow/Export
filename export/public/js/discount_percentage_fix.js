/**
 * ERPNext core zeroes out a row's Discount % (and Discount Amount) the instant
 * it's entered whenever that row's Price List Rate is blank/0 - see:
 *   erpnext/public/js/utils/sales_common.js  -> discount_percentage()/discount_amount()
 *   erpnext/public/js/controllers/buying.js  -> discount_percentage()/discount_amount()
 *   erpnext/public/js/controllers/transaction.js -> the "rate" trigger, which
 *     unconditionally resets discount_percentage to 0 when price_list_rate is falsy.
 *
 * Many rows here (fetched via "Get Items From", manual entry, etc.) never get a
 * Price List Rate populated, so a manually typed discount was always wiped back
 * to 0 before the user could save it - regardless of any Property Setter making
 * the field visible/editable, since that only controls the UI, not this logic.
 *
 * Fix: when a row has no Price List Rate, use its current Rate (or Rate +
 * entered Discount Amount) as the reference price *before* the core handlers
 * run, so the discount the user typed actually reduces the rate instead of
 * being discarded.
 */
(function () {
	function with_price_list_rate_fallback(original) {
		if (typeof original !== "function") return original;
		return function (doc, cdt, cdn) {
			let item = frappe.get_doc(cdt, cdn);
			if (item && !item.price_list_rate) {
				if (item.discount_amount) {
					item.price_list_rate = flt(item.rate) + flt(item.discount_amount);
				} else if (item.rate) {
					item.price_list_rate = item.rate;
				}
			}
			return original.apply(this, arguments);
		};
	}

	function patch(controller) {
		if (!controller || controller.__gme_discount_fix_applied) return;
		let proto = controller.prototype;
		proto.discount_percentage = with_price_list_rate_fallback(proto.discount_percentage);
		proto.discount_amount = with_price_list_rate_fallback(proto.discount_amount);
		controller.__gme_discount_fix_applied = true;
	}

	patch(erpnext.selling && erpnext.selling.SellingController);
	patch(erpnext.buying && erpnext.buying.BuyingController);
})();
