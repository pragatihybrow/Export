frappe.ui.form.on("Quotation", {
	setup(frm) {
		frm.set_query("custom_transporter", {
			filters: {
				is_transporter: 1,
			},
		});
	},
});
