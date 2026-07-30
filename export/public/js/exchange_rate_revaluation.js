// Overrides the core "Reversal Journal Entries" button behaviour.
//
// Core (erpnext/.../exchange_rate_revaluation.js) calls frm.events.make_reverse_journal,
// which hits the server-side make_reverse_journal method that hardcodes posting_date to
// today and auto-submits the reversal Journal Entry with no review step.
//
// Redefining make_reverse_journal here (loaded after core) takes over that same button
// click and instead prompts for a posting date, then creates the reversal as a Draft via
// a separate whitelisted method so it can be reviewed before submission.
frappe.ui.form.on("Exchange Rate Revaluation", {
	make_reverse_journal: function (frm) {
		let dialog = new frappe.ui.Dialog({
			title: __("Reversal Journal Entry"),
			fields: [
				{
					fieldname: "posting_date",
					fieldtype: "Date",
					label: __("Posting Date"),
					default: frappe.datetime.get_today(),
					reqd: 1,
				},
			],
			primary_action_label: __("Create"),
			primary_action: function (values) {
				dialog.hide();
				frappe.call({
					method: "export.api.exchange_rate_revaluation.make_reverse_journal_draft",
					args: {
						docname: frm.doc.name,
						posting_date: values.posting_date,
					},
					freeze: true,
					freeze_message: __("Creating Reversal Journal Entry..."),
					callback: function () {
						frm.reload_doc();
					},
				});
			},
		});
		dialog.show();
	},
});
