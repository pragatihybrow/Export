frappe.ui.form.on("Quotation", {
	setup(frm) {
		frm.set_query("custom_transporter", {
			filters: {
				is_transporter: 1,
			},
		});
	},

	custom_bank_account(frm) {
		// fetch_from only supports a single hop (link_field.target_field), so the
		// SWIFT number one link further away (Bank Account -> Bank -> swift_number)
		// can't be pulled with a dotted fetch_from chain - fetch it manually here.
		if (!frm.doc.custom_bank_account) {
			frm.set_value("custom_swift_code", "");
			return;
		}
		frappe.db.get_value("Bank Account", frm.doc.custom_bank_account, "bank").then((r) => {
			let bank = r.message && r.message.bank;
			if (!bank) {
				frm.set_value("custom_swift_code", "");
				return;
			}
			frappe.db.get_value("Bank", bank, "swift_number").then((r2) => {
				frm.set_value("custom_swift_code", (r2.message && r2.message.swift_number) || "");
			});
		});
	},
});
